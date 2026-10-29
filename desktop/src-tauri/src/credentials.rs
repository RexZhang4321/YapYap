//! Secrets stay in the OS credential store and are never returned through IPC.
use zeroize::Zeroizing;

// Keep the original credential target so existing saved keys survive the rename.
const TARGET: &str = "app.byokdictation.hotkeyprobe/openai-api-key";
const MAX_KEY_BYTES: usize = 2560;

// Validate only the token's transport/storage constraints, not a changing prefix.
fn key_text(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("key_empty".into());
    }
    if key.len() > MAX_KEY_BYTES || !key.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return Err("key_format".into());
    }
    Ok(key)
}

async fn credential_task<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "credential_operation_failed".to_string())?
}

#[tauri::command]
pub async fn has_api_key() -> Result<bool, String> {
    credential_task(|| PlatformCredentialStore::read(TARGET).map(|key| key.is_some())).await
}

// Only an explicit Settings action may ask the user for Keychain access.
#[tauri::command]
pub async fn unlock_api_key() -> Result<bool, String> {
    credential_task(|| PlatformCredentialStore::unlock(TARGET)).await
}

#[tauri::command]
pub async fn save_api_key(key: String) -> Result<(), String> {
    let key = Zeroizing::new(key);
    credential_task(move || PlatformCredentialStore::write(TARGET, key_text(&key)?)).await
}

#[tauri::command]
pub async fn delete_api_key() -> Result<(), String> {
    credential_task(|| PlatformCredentialStore::delete(TARGET)).await
}

#[tauri::command]
pub async fn validate_api_key() -> Result<(), String> {
    credential_task(|| {
        let key =
            PlatformCredentialStore::read(TARGET)?.ok_or_else(|| "key_missing".to_string())?;
        crate::openai::validate_key(key_text(&key)?)
    })
    .await
}

// Rust callers only: secrets never cross the command boundary back to the UI.
pub(crate) fn with_api_key<T>(work: impl FnOnce(&str) -> Result<T, String>) -> Result<T, String> {
    let key = PlatformCredentialStore::read(TARGET)?.ok_or_else(|| "key_missing".to_string())?;
    work(key_text(&key)?)
}

// Each backend implements the same contract, including explicit interactive unlock.
trait CredentialStore {
    fn read(target: &str) -> Result<Option<Zeroizing<String>>, String>;
    fn write(target: &str, key: &str) -> Result<(), String>;
    fn delete(target: &str) -> Result<(), String>;
    fn unlock(target: &str) -> Result<bool, String>;
}

#[cfg(windows)]
#[path = "credentials/windows.rs"]
mod native;
#[cfg(target_os = "macos")]
#[path = "credentials/macos.rs"]
mod native;
#[cfg(not(any(windows, target_os = "macos")))]
#[path = "credentials/unsupported.rs"]
mod native;

struct PlatformCredentialStore;
impl CredentialStore for PlatformCredentialStore {
    fn read(target: &str) -> Result<Option<Zeroizing<String>>, String> {
        native::read(target)
    }
    fn write(target: &str, key: &str) -> Result<(), String> {
        native::write(target, key)
    }
    fn delete(target: &str) -> Result<(), String> {
        native::delete(target)
    }
    fn unlock(target: &str) -> Result<bool, String> {
        native::unlock(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "Uses a disposable Keychain item, never the app's saved key"]
    fn macos_keychain_lifecycle() {
        let target = format!("{TARGET}/probe-{}", std::process::id());
        let result = (|| -> Result<(), String> {
            PlatformCredentialStore::delete(&target)?;
            assert!(PlatformCredentialStore::read(&target)?.is_none());
            PlatformCredentialStore::write(&target, "sk-disposable-original")?;
            assert!(PlatformCredentialStore::unlock(&target)?);
            assert!(PlatformCredentialStore::read(&target)?
                .is_some_and(|key| *key == "sk-disposable-original"));
            PlatformCredentialStore::write(&target, "sk-disposable-replaced")?;
            assert!(PlatformCredentialStore::read(&target)?
                .is_some_and(|key| *key == "sk-disposable-replaced"));
            PlatformCredentialStore::delete(&target)?;
            PlatformCredentialStore::delete(&target)?;
            assert!(PlatformCredentialStore::read(&target)?.is_none());
            Ok(())
        })();
        let cleanup = PlatformCredentialStore::delete(&target);
        assert!(cleanup.is_ok(), "Disposable Keychain cleanup failed");
        assert!(result.is_ok(), "Disposable Keychain lifecycle failed");
    }

    #[test]
    fn token_constraints_reject_header_injection_without_echoing_the_input() {
        for token in [
            "",
            "  ",
            "fixture\r\nAuthorization: other",
            "fixture secret",
            "☃",
        ] {
            let error = key_text(token).unwrap_err();
            assert!(matches!(error.as_str(), "key_empty" | "key_format"));
        }
        assert_eq!(
            key_text("\n sk-fixture-only \r\n").unwrap(),
            "sk-fixture-only"
        );
        assert!(key_text(&"x".repeat(MAX_KEY_BYTES)).is_ok());
        assert_eq!(
            key_text(&"x".repeat(MAX_KEY_BYTES + 1)).unwrap_err(),
            "key_format"
        );
    }

    // Opt-in native probe. Uses a unique disposable target, never the app's key.
    #[cfg(windows)]
    #[test]
    #[ignore = "Writes a disposable fixture to Windows Credential Manager; no API call"]
    fn windows_credential_restart_probe() {
        use std::{
            process::Command,
            time::{SystemTime, UNIX_EPOCH},
        };
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let target = format!("{TARGET}/probe-{}-{suffix}", std::process::id());
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = PlatformCredentialStore::delete(&self.0);
            }
        }
        let _cleanup = Cleanup(target.clone());
        assert!(PlatformCredentialStore::read(&target).unwrap().is_none());
        PlatformCredentialStore::write(&target, "sk-disposable-credential-fixture").unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "credentials::tests::credential_restart_reader",
                "--ignored",
            ])
            .env("YAPYAP_CREDENTIAL_PROBE_TARGET", &target)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Child-process credential retrieval failed"
        );
        PlatformCredentialStore::write(&target, "sk-replacement-fixture").unwrap();
        let restored = PlatformCredentialStore::read(&target).unwrap().unwrap();
        assert!(
            *restored == "sk-replacement-fixture",
            "Credential replacement failed"
        );
        PlatformCredentialStore::delete(&target).unwrap();
        PlatformCredentialStore::delete(&target).unwrap();
        assert!(PlatformCredentialStore::read(&target).unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Child-process helper for windows_credential_restart_probe"]
    fn credential_restart_reader() {
        let target = std::env::var("YAPYAP_CREDENTIAL_PROBE_TARGET")
            .expect("Run windows_credential_restart_probe instead");
        assert!(target.starts_with(&format!("{TARGET}/probe-")));
        let restored = PlatformCredentialStore::read(&target).unwrap().unwrap();
        assert!(
            *restored == "sk-disposable-credential-fixture",
            "Credential retrieval failed"
        );
    }
}
