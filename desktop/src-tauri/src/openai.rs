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

#[cfg(any(windows, test))]
fn request_headers(key: &str, content_type: Option<&str>) -> zeroize::Zeroizing<Vec<u16>> {
    // Reserve the complete header before writing any secret: later Content-Type
    // appends must not reallocate and leave an unwiped key in the old allocation.
    let content_type_units = content_type.map_or(0, |value| 14 + value.encode_utf16().count() + 2);
    let mut header = zeroize::Zeroizing::new(Vec::<u16>::with_capacity(
        22 + key.encode_utf16().count() + 3 + content_type_units,
    ));
    header.extend("Authorization: Bearer ".encode_utf16());
    header.extend(key.encode_utf16());
    header.extend("\r\n".encode_utf16());
    if let Some(content_type) = content_type {
        header.extend("Content-Type: ".encode_utf16());
        header.extend(content_type.encode_utf16());
        header.extend("\r\n".encode_utf16());
    }
    header.push(0);
    header
}

#[cfg(windows)]
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

#[cfg(windows)]
pub(crate) fn request(
    key: &str,
    method: &str,
    path: &str,
    body: &[u8],
    content_type: Option<&str>,
    check_status: fn(u32) -> Result<(), String>,
    read_body: bool,
) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, mem::size_of, ptr};
    use windows_sys::Win32::{Foundation::GetLastError, Networking::WinHttp::*};

    struct Handle(*mut c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
    fn handle(raw: *mut c_void) -> Result<Handle, String> {
        if raw.is_null() {
            Err(network_error())
        } else {
            Ok(Handle(raw))
        }
    }
    fn network_error() -> String {
        // Return a fixed code only. URLs, headers and provider bodies stay private.
        match unsafe { GetLastError() } {
            ERROR_WINHTTP_TIMEOUT => "validation_timeout",
            ERROR_WINHTTP_SECURE_FAILURE => "validation_tls_failed",
            _ => "validation_network_failed",
        }
        .into()
    }
    fn check(result: i32) -> Result<(), String> {
        if result == 0 {
            Err(network_error())
        } else {
            Ok(())
        }
    }
    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    let agent = wide("BYOK Dictation Probe/0.1");
    let host = wide("api.openai.com");
    let method = wide(method);
    let path = wide(path);
    let header = request_headers(key, content_type);

    // The WinHTTP handles are synchronous and confined to this worker thread.
    // TLS certificate checks remain enabled; redirects cannot move the credential.
    unsafe {
        let session = handle(WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            ptr::null(),
            ptr::null(),
            0,
        ))?;
        check(WinHttpSetTimeouts(
            session.0,
            10_000,
            10_000,
            if read_body { 60_000 } else { 10_000 },
            if read_body { 60_000 } else { 10_000 },
        ))?;
        let connection = handle(WinHttpConnect(session.0, host.as_ptr(), 443, 0))?;
        let request = handle(WinHttpOpenRequest(
            connection.0,
            method.as_ptr(),
            path.as_ptr(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            WINHTTP_FLAG_SECURE,
        ))?;
        let redirect_policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        check(WinHttpSetOption(
            request.0,
            WINHTTP_OPTION_REDIRECT_POLICY,
            (&redirect_policy as *const u32).cast(),
            size_of::<u32>() as u32,
        ))?;
        check(WinHttpSendRequest(
            request.0,
            header.as_ptr(),
            (header.len() - 1) as u32,
            if body.is_empty() {
                ptr::null()
            } else {
                body.as_ptr().cast()
            },
            body.len() as u32,
            body.len() as u32,
            0,
        ))?;
        check(WinHttpReceiveResponse(request.0, ptr::null_mut()))?;
        let mut status = 0u32;
        let mut bytes = size_of::<u32>() as u32;
        check(WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            ptr::null(),
            (&mut status as *mut u32).cast(),
            &mut bytes,
            ptr::null_mut(),
        ))?;
        // Reject failures before reading their potentially sensitive bodies.
        check_status(status)?;
        let mut result = Vec::new();
        if read_body {
            let mut chunk = [0u8; 8192];
            loop {
                let mut received = 0u32;
                check(WinHttpReadData(
                    request.0,
                    chunk.as_mut_ptr().cast(),
                    chunk.len() as u32,
                    &mut received,
                ))?;
                if received == 0 {
                    break;
                }
                if result.len() + received as usize > 1024 * 1024 {
                    return Err("transcription_response_too_large".into());
                }
                result.extend_from_slice(&chunk[..received as usize]);
            }
        }
        Ok(result)
    }
}

#[cfg(not(windows))]
pub fn validate_key(_: &str) -> Result<(), String> {
    Err("credential_platform_unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secret_headers_reserve_the_full_buffer_before_copying_the_key() {
        let large_content_type = format!("multipart/form-data; boundary={}", "x".repeat(4096));
        for content_type in [
            None,
            Some("audio/wav"),
            Some(large_content_type.as_str()),
            Some("fixture-☃"),
        ] {
            let header = request_headers("sk-fixture-only", content_type);
            // Growing a too-small buffer would leave spare capacity here.
            assert_eq!(header.len(), header.capacity());
            assert_eq!(header.last(), Some(&0));
            let text = String::from_utf16(&header[..header.len() - 1]).unwrap();
            assert!(text.starts_with("Authorization: Bearer sk-fixture-only\r\n"));
            if let Some(content_type) = content_type {
                assert!(text.ends_with(&format!("Content-Type: {content_type}\r\n")));
            }
        }
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

    #[cfg(windows)]
    #[test]
    #[ignore = "Real API request using a deliberately invalid fixture key; no saved key is read"]
    fn openai_rejects_invalid_fixture_key() {
        assert_eq!(
            validate_key("sk-disposable-invalid-validation-fixture").unwrap_err(),
            "validation_unauthorized"
        );
    }
}
