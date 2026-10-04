//! Whole-recording canonical transcription. No audio files or content logging.
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_AUDIO_BYTES: usize = 25_000_000;
const BOUNDARY: &str = "byok-dictation-wav-boundary";
static REQUEST_ACTIVE: AtomicBool = AtomicBool::new(false);

// Provider-independent transport seam for deterministic probes and later providers.
trait FinalSTT {
    fn transcribe(&self, audio: &[u8]) -> Result<String, String>;
}

struct OpenAiFinalSTT;
impl FinalSTT for OpenAiFinalSTT {
    fn transcribe(&self, audio: &[u8]) -> Result<String, String> {
        let body = multipart(audio)?;
        #[cfg(windows)]
        {
            let response = crate::credentials::with_api_key(|key| {
                crate::openai::request(
                    key,
                    "POST",
                    "/v1/audio/transcriptions",
                    &body,
                    Some(&format!("multipart/form-data; boundary={BOUNDARY}")),
                    transcription_status,
                    true,
                )
            })?;
            parse_transcript(&response)
        }
        #[cfg(not(windows))]
        {
            let _ = body;
            Err("credential_platform_unsupported".into())
        }
    }
}

fn validate_audio(audio: &[u8]) -> Result<(), String> {
    if audio.len() > MAX_AUDIO_BYTES {
        return Err("transcription_audio_too_large".into());
    }
    // Only accept the PCM16 mono WAV produced by our capture encoder.
    if audio.len() <= 44
        || &audio[..4] != b"RIFF"
        || &audio[8..16] != b"WAVEfmt "
        || &audio[36..40] != b"data"
        || u32::from_le_bytes(audio[16..20].try_into().unwrap()) != 16
        || u16::from_le_bytes(audio[20..22].try_into().unwrap()) != 1
        || u16::from_le_bytes(audio[22..24].try_into().unwrap()) != 1
        || u16::from_le_bytes(audio[34..36].try_into().unwrap()) != 16
        || u32::from_le_bytes(audio[40..44].try_into().unwrap()) as usize != audio.len() - 44
        || u32::from_le_bytes(audio[4..8].try_into().unwrap()) as usize != audio.len() - 8
        || (audio.len() - 44) % 2 != 0
    {
        return Err("transcription_audio_invalid".into());
    }
    let rate = u32::from_le_bytes(audio[24..28].try_into().unwrap());
    if !(8_000..=192_000).contains(&rate)
        || u16::from_le_bytes(audio[32..34].try_into().unwrap()) != 2
        || u32::from_le_bytes(audio[28..32].try_into().unwrap()) != rate * 2
    {
        return Err("transcription_audio_invalid".into());
    }
    Ok(())
}

fn multipart(audio: &[u8]) -> Result<Vec<u8>, String> {
    validate_audio(audio)?;
    // PCM bytes can contain any byte sequence: reject a delimiter collision.
    if audio
        .windows(BOUNDARY.len())
        .any(|window| window == BOUNDARY.as_bytes())
    {
        return Err("transcription_audio_invalid".into());
    }
    let mut body = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-transcribe\r\n\
         --{BOUNDARY}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n\
         --{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
    ).into_bytes();
    body.extend_from_slice(audio);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    Ok(body)
}

fn transcription_status(status: u32) -> Result<(), String> {
    let code = match status {
        200 => return Ok(()),
        401 => "transcription_unauthorized",
        403 => "transcription_forbidden",
        404 => "transcription_model_unavailable",
        413 => "transcription_audio_too_large",
        429 => "transcription_rate_limited",
        500..=599 => "transcription_provider_unavailable",
        300..=399 => "transcription_redirect",
        _ => "transcription_unexpected_response",
    };
    Err(code.into())
}

fn parse_transcript(response: &[u8]) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_slice(response)
        .map_err(|_| "transcription_response_invalid".to_string())?;
    let text = value
        .get("text")
        .and_then(|text| text.as_str())
        .ok_or_else(|| "transcription_response_invalid".to_string())?;
    // Clipboard insertion/Copy cannot transport an embedded NUL. Reject it
    // before canonical success so the UI retains the original audio for retry.
    if text.contains('\0') {
        return Err("transcription_response_invalid".into());
    }
    if text.trim().is_empty() {
        return Err("transcription_empty".into());
    }
    Ok(text.to_owned())
}

fn finalize(audio: &[u8], provider: &impl FinalSTT) -> Result<String, String> {
    validate_audio(audio)?;
    provider.transcribe(audio)
}

#[tauri::command]
pub async fn transcribe_recording(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let audio = match request.body() {
        tauri::ipc::InvokeBody::Raw(audio) => {
            validate_audio(audio)?;
            audio.clone()
        }
        _ => return Err("transcription_audio_invalid".into()),
    };
    if REQUEST_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("transcription_busy".into());
    }
    struct ActiveRequest;
    impl Drop for ActiveRequest {
        fn drop(&mut self) {
            REQUEST_ACTIVE.store(false, Ordering::Release);
        }
    }
    let guard = ActiveRequest;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        finalize(&audio, &OpenAiFinalSTT)
    })
    .await
    .map_err(|_| "transcription_operation_failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav() -> Vec<u8> {
        let mut audio = vec![0; 48];
        audio[..4].copy_from_slice(b"RIFF");
        audio[4..8].copy_from_slice(&40u32.to_le_bytes());
        audio[8..16].copy_from_slice(b"WAVEfmt ");
        audio[16..20].copy_from_slice(&16u32.to_le_bytes());
        audio[20..22].copy_from_slice(&1u16.to_le_bytes());
        audio[22..24].copy_from_slice(&1u16.to_le_bytes());
        audio[24..28].copy_from_slice(&48_000u32.to_le_bytes());
        audio[28..32].copy_from_slice(&96_000u32.to_le_bytes());
        audio[32..34].copy_from_slice(&2u16.to_le_bytes());
        audio[34..36].copy_from_slice(&16u16.to_le_bytes());
        audio[36..40].copy_from_slice(b"data");
        audio[40..44].copy_from_slice(&4u32.to_le_bytes());
        audio
    }

    #[test]
    fn multipart_preserves_wav_bytes_and_declares_model_and_format() {
        let audio = wav();
        let body = multipart(&audio).unwrap();
        assert!(body.windows(audio.len()).any(|window| window == audio));
        let header = String::from_utf8_lossy(&body);
        assert!(header.contains("name=\"model\"\r\n\r\ngpt-transcribe\r\n"));
        assert!(header.contains("filename=\"recording.wav\"\r\nContent-Type: audio/wav"));
        assert!(body.ends_with(format!("\r\n--{BOUNDARY}--\r\n").as_bytes()));
    }

    #[test]
    fn invalid_empty_and_oversized_audio_never_reach_provider() {
        struct NeverCalled;
        impl FinalSTT for NeverCalled {
            fn transcribe(&self, _: &[u8]) -> Result<String, String> {
                panic!("Invalid upload reached provider");
            }
        }
        for audio in [vec![], vec![0; 44], vec![0; MAX_AUDIO_BYTES + 1]] {
            assert!(finalize(&audio, &NeverCalled).is_err());
        }
        let mut audio = wav();
        audio[40] = 8;
        assert!(finalize(&audio, &NeverCalled).is_err());
    }

    #[test]
    fn response_preserves_unicode_newlines_and_identifiers() {
        assert_eq!(
            parse_transcript(
                br#"{"text":"Hello\n\u4f60\u597d MicroDuck XL330 https://example.com"}"#
            )
            .unwrap(),
            "Hello\n你好 MicroDuck XL330 https://example.com"
        );
        for response in [
            b"not json".as_slice(),
            br#"{"text":123}"#,
            br#"{}"#,
            br#"{"text":"hello\u0000hidden"}"#,
        ] {
            assert_eq!(
                parse_transcript(response).unwrap_err(),
                "transcription_response_invalid"
            );
        }
        assert_eq!(
            parse_transcript(br#"{"text":"  "}"#).unwrap_err(),
            "transcription_empty"
        );
    }

    #[test]
    fn failed_provider_can_retry_the_same_original_audio() {
        use std::cell::Cell;
        struct RetryFake(Cell<bool>);
        impl FinalSTT for RetryFake {
            fn transcribe(&self, audio: &[u8]) -> Result<String, String> {
                assert_eq!(audio, wav());
                if self.0.replace(true) {
                    Ok("Recovered dictation".into())
                } else {
                    Err("validation_network_failed".into())
                }
            }
        }
        let audio = wav();
        let provider = RetryFake(Cell::new(false));
        assert!(finalize(&audio, &provider).is_err());
        assert_eq!(finalize(&audio, &provider).unwrap(), "Recovered dictation");
        assert_eq!(audio, wav());
    }

    #[test]
    fn http_errors_are_fixed_codes() {
        for (status, code) in [
            (401, "transcription_unauthorized"),
            (403, "transcription_forbidden"),
            (404, "transcription_model_unavailable"),
            (413, "transcription_audio_too_large"),
            (429, "transcription_rate_limited"),
            (503, "transcription_provider_unavailable"),
            (302, "transcription_redirect"),
            (400, "transcription_unexpected_response"),
        ] {
            assert_eq!(transcription_status(status).unwrap_err(), code);
        }
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Real OpenAI request with invalid fixture key and synthetic silence; reads no saved credential"]
    fn openai_rejects_invalid_transcription_key() {
        let body = multipart(&wav()).unwrap();
        let result = crate::openai::request(
            "sk-disposable-invalid-transcription-fixture",
            "POST",
            "/v1/audio/transcriptions",
            &body,
            Some(&format!("multipart/form-data; boundary={BOUNDARY}")),
            transcription_status,
            true,
        );
        assert_eq!(result.unwrap_err(), "transcription_unauthorized");
    }
}
