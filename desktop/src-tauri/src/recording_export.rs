use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

fn save_recording(directory: &Path, audio: &[u8]) -> Result<PathBuf, String> {
    if audio.len() < 44 || &audio[..4] != b"RIFF" || &audio[8..12] != b"WAVE" {
        return Err("recording_invalid".into());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "recording_save_failed")?
        .as_millis();
    for suffix in 0..100 {
        let path = directory.join(format!("YapYap-recording-{timestamp}-{suffix}.wav"));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                if file.write_all(audio).is_err() {
                    drop(file);
                    let _ = std::fs::remove_file(&path);
                    return Err("recording_save_failed".into());
                }
                return Ok(path);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("recording_save_failed".into()),
        }
    }
    Err("recording_save_failed".into())
}

#[tauri::command]
pub async fn download_recording(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let audio = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("recording_invalid".into()),
    };
    let directory = app
        .path()
        .download_dir()
        .map_err(|_| "recording_save_failed")?;
    tauri::async_runtime::spawn_blocking(move || save_recording(&directory, &audio))
        .await
        .map_err(|_| "recording_save_failed")?
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_exact_audio_without_overwriting() {
        let directory =
            std::env::temp_dir().join(format!("yapyap-export-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut wav = vec![0; 48];
        wav[..4].copy_from_slice(b"RIFF");
        wav[8..12].copy_from_slice(b"WAVE");
        let first = save_recording(&directory, &wav).unwrap();
        let second = save_recording(&directory, &wav).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), wav);
        assert!(save_recording(&directory, b"invalid").is_err());
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
