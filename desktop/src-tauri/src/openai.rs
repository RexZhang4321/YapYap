//! Native HTTPS to OpenAI. Errors are fixed codes, never provider response bodies.
fn validation_status(status: u32) -> Result<(), String> {
    match status {
        200 => Ok(()),
        401 => Err("validation_unauthorized".into()),
        403 => Err("validation_forbidden".into()),
        429 => Err("validation_rate_limited".into()),
        500..=599 => Err("validation_provider_unavailable".into()),
        300..=399 => Err("validation_redirect".into()),
        _ => Err("validation_unexpected_response".into()),
    }
}

const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const PROVIDER_BASE: &str = "https://api.openai.com";

pub fn validate_key(key: &str) -> Result<(), String> {
    request(
        key,
        "GET",
        "/v1/models",
        &[],
        None,
        validation_status,
        false,
    )
    .map(|_| ())
}

pub(crate) fn request(
    key: &str,
    method: &str,
    path: &str,
    body: &[u8],
    content_type: Option<&str>,
    check_status: fn(u32) -> Result<(), String>,
    read_body: bool,
) -> Result<Vec<u8>, String> {
    // Callers supply only fixed, application-owned paths. Never expose a URL or
    // allow a redirect to send credentials or dictation to another host.
    if !path.starts_with("/v1/") || path.contains(['?', '#', '\\']) {
        return Err("validation_network_failed".into());
    }
    let url = format!("{PROVIDER_BASE}{path}");
    request_url(
        &url,
        key,
        method,
        body,
        content_type,
        check_status,
        read_body,
        std::time::Duration::from_secs(if read_body { 60 } else { 10 }),
    )
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "validation_timeout"
    } else {
        "validation_network_failed"
    }
    .into()
}

fn request_url(
    url: &str,
    key: &str,
    method: &str,
    body: &[u8],
    content_type: Option<&str>,
    check_status: fn(u32) -> Result<(), String>,
    read_body: bool,
    timeout: std::time::Duration,
) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(timeout)
        .user_agent("YapYap/0.1")
        .build()
        .map_err(network_error)?;
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "validation_network_failed".to_string())?;
    let auth = zeroize::Zeroizing::new(format!("Bearer {key}"));
    let mut header = reqwest::header::HeaderValue::from_str(&auth)
        .map_err(|_| "validation_network_failed".to_string())?;
    header.set_sensitive(true);
    let mut request = client
        .request(method, url)
        .header(reqwest::header::AUTHORIZATION, header);
    if let Some(value) = content_type {
        request = request.header(reqwest::header::CONTENT_TYPE, value);
    }
    if !body.is_empty() {
        request = request.body(body.to_vec());
    }
    let response = request.send().map_err(network_error)?;
    check_status(u32::from(response.status().as_u16()))?;
    if !read_body {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut result)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::TimedOut
                || error
                    .get_ref()
                    .and_then(|source| source.downcast_ref::<reqwest::Error>())
                    .is_some_and(reqwest::Error::is_timeout)
            {
                "validation_timeout".to_string()
            } else {
                "validation_network_failed".to_string()
            }
        })?;
    if result.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("transcription_response_too_large".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A local peer exercises the real HTTP client without credentials or provider calls.
    fn fixture(
        response: Vec<u8>,
        delay: std::time::Duration,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut request = [0u8; 4096];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]).to_lowercase();
            assert!(request.contains("authorization: bearer sk-fixture-only"));
            std::thread::sleep(delay);
            let _ = stream.write_all(&response);
        });
        (format!("http://{address}/v1/test"), thread)
    }

    #[test]
    fn shared_http_client_bounds_response_and_does_not_follow_redirects() {
        for (response, expected) in [
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".to_vec(),
                Ok(b"ok".to_vec()),
            ),
            (
                b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/\r\nContent-Length: 0\r\n\r\n"
                    .to_vec(),
                Err("validation_redirect".to_string()),
            ),
            (
                {
                    let mut r = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                        MAX_RESPONSE_BYTES + 1
                    )
                    .into_bytes();
                    r.extend(vec![b'x'; MAX_RESPONSE_BYTES as usize + 1]);
                    r
                },
                Err("transcription_response_too_large".to_string()),
            ),
        ] {
            let (url, peer) = fixture(response, std::time::Duration::ZERO);
            let result = request_url(
                &url,
                "sk-fixture-only",
                "GET",
                &[],
                None,
                validation_status,
                true,
                std::time::Duration::from_secs(5),
            );
            peer.join().unwrap();
            assert_eq!(result, expected);
        }
    }

    #[test]
    fn shared_http_client_times_out_slow_responses() {
        let (url, peer) = fixture(
            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_vec(),
            std::time::Duration::from_millis(250),
        );
        let result = request_url(
            &url,
            "sk-fixture-only",
            "GET",
            &[],
            None,
            validation_status,
            true,
            std::time::Duration::from_millis(100),
        );
        peer.join().unwrap();
        assert_eq!(result.unwrap_err(), "validation_timeout");
    }

    #[test]
    fn shared_http_client_times_out_stalled_response_body() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/test", listener.local_addr().unwrap());
        let peer = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            stream.read(&mut request).unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\no")
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(250));
            let _ = stream.write_all(b"k");
        });
        let result = request_url(
            &url,
            "sk-fixture-only",
            "GET",
            &[],
            None,
            validation_status,
            true,
            std::time::Duration::from_millis(100),
        );
        peer.join().unwrap();
        assert_eq!(result.unwrap_err(), "validation_timeout");
    }

    #[test]
    fn shared_http_client_sends_exact_post_body_and_authorization_header() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/test", listener.local_addr().unwrap());
        let peer = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            let end = loop {
                let read = stream.read(&mut buffer).unwrap();
                assert_ne!(read, 0);
                request.extend_from_slice(&buffer[..read]);
                if let Some(index) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
            assert!(headers.starts_with("post /v1/test http/1.1\r\n"));
            assert!(headers.contains("authorization: bearer sk-fixture-only\r\n"));
            assert!(headers.contains("content-type: application/json\r\n"));
            while request.len() - end < 16 {
                let read = stream.read(&mut buffer).unwrap();
                assert_ne!(read, 0);
                request.extend_from_slice(&buffer[..read]);
            }
            assert_eq!(&request[end..], br#"{"fixture":true}"#);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                .unwrap();
        });
        let result = request_url(
            &url,
            "sk-fixture-only",
            "POST",
            br#"{"fixture":true}"#,
            Some("application/json"),
            validation_status,
            true,
            std::time::Duration::from_secs(5),
        );
        peer.join().unwrap();
        assert_eq!(result.unwrap(), b"ok");
    }
    #[test]
    fn validation_distinguishes_auth_permissions_rate_limits_and_provider_failure() {
        assert!(validation_status(200).is_ok());
        for (status, error) in [
            (401, "validation_unauthorized"),
            (403, "validation_forbidden"),
            (429, "validation_rate_limited"),
            (503, "validation_provider_unavailable"),
            (302, "validation_redirect"),
            (404, "validation_unexpected_response"),
        ] {
            assert_eq!(validation_status(status).unwrap_err(), error);
        }
    }

    #[test]
    #[ignore = "Real API request using a deliberately invalid fixture key; no saved key is read"]
    fn openai_rejects_invalid_fixture_key() {
        assert_eq!(
            validate_key("sk-disposable-invalid-validation-fixture").unwrap_err(),
            "validation_unauthorized"
        );
    }
}
