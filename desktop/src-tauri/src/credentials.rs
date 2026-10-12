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
    credential_task(|| native::read(TARGET).map(|key| key.is_some())).await
}

// Only an explicit Settings action may ask the user for Keychain access.
#[tauri::command]
pub async fn unlock_api_key() -> Result<bool, String> {
    credential_task(|| {
        #[cfg(target_os = "macos")]
        return native::unlock(TARGET);
        #[cfg(not(target_os = "macos"))]
        native::read(TARGET).map(|key| key.is_some())
    })
    .await
}

#[tauri::command]
pub async fn save_api_key(key: String) -> Result<(), String> {
    let key = Zeroizing::new(key);
    credential_task(move || native::write(TARGET, key_text(&key)?)).await
}

#[tauri::command]
pub async fn delete_api_key() -> Result<(), String> {
    credential_task(|| native::delete(TARGET)).await
}

#[tauri::command]
pub async fn validate_api_key() -> Result<(), String> {
    credential_task(|| {
        let key = native::read(TARGET)?.ok_or_else(|| "key_missing".to_string())?;
        crate::openai::validate_key(key_text(&key)?)
    })
    .await
}

// Rust callers only: secrets never cross the command boundary back to the UI.
pub(crate) fn with_api_key<T>(work: impl FnOnce(&str) -> Result<T, String>) -> Result<T, String> {
    let key = native::read(TARGET)?.ok_or_else(|| "key_missing".to_string())?;
    work(key_text(&key)?)
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };
    use zeroize::Zeroize;

    // Own the allocation returned by CredReadW and wipe its secret before freeing it.
    struct Credential(*mut CREDENTIALW);

    impl Drop for Credential {
        fn drop(&mut self) {
            unsafe {
                let credential = &mut *self.0;
                if !credential.CredentialBlob.is_null() && credential.CredentialBlobSize > 0 {
                    std::slice::from_raw_parts_mut(
                        credential.CredentialBlob,
                        credential.CredentialBlobSize as usize,
                    )
                    .zeroize();
                }
                CredFree(self.0.cast());
            }
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    pub(super) fn write(target: &str, key: &str) -> Result<(), String> {
        let key = key_text(key)?;
        let mut target = wide(target);
        let mut user = wide("OpenAI");
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            UserName: user.as_mut_ptr(),
            CredentialBlobSize: key.len() as u32,
            CredentialBlob: key.as_ptr().cast_mut(),
            // Same Windows user on this machine; no roaming or app-owned secret file.
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // All borrowed fields remain alive through the synchronous OS call.
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err("credential_write_failed".into());
        }
        Ok(())
    }

    pub(super) fn read(target: &str) -> Result<Option<Zeroizing<String>>, String> {
        let target = wide(target);
        let mut raw = ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err("credential_read_failed".into())
            };
        }
        if raw.is_null() {
            return Err("credential_read_failed".into());
        }
        let allocation = Credential(raw);
        let credential = unsafe { &*allocation.0 };
        if credential.CredentialBlob.is_null()
            || credential.CredentialBlobSize == 0
            || credential.CredentialBlobSize as usize > MAX_KEY_BYTES
        {
            return Err("credential_invalid".into());
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            )
        };
        let text = std::str::from_utf8(bytes).map_err(|_| "credential_invalid".to_string())?;
        key_text(text).map_err(|_| "credential_invalid".to_string())?;
        Ok(Some(Zeroizing::new(text.to_owned())))
    }

    pub(super) fn delete(target: &str) -> Result<(), String> {
        let target = wide(target);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            return Err("credential_delete_failed".into());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use core_foundation::{
        base::{CFType, CFTypeRef, TCFType},
        boolean::CFBoolean,
        data::CFData,
        dictionary::{CFDictionary, CFDictionaryRef},
        string::{CFString, CFStringRef},
    };

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kSecClass: CFStringRef;
        static kSecClassGenericPassword: CFStringRef;
        static kSecAttrService: CFStringRef;
        static kSecAttrAccount: CFStringRef;
        static kSecValueData: CFStringRef;
        static kSecReturnData: CFStringRef;
        static kSecMatchLimit: CFStringRef;
        static kSecMatchLimitOne: CFStringRef;
        static kSecUseAuthenticationUI: CFStringRef;
        static kSecUseAuthenticationUIFail: CFStringRef;
        static kSecUseAuthenticationUIAllow: CFStringRef;
        fn SecItemCopyMatching(query: CFDictionaryRef, result: *mut CFTypeRef) -> i32;
        fn SecItemAdd(query: CFDictionaryRef, result: *mut CFTypeRef) -> i32;
        fn SecItemUpdate(query: CFDictionaryRef, attributes: CFDictionaryRef) -> i32;
        fn SecItemDelete(query: CFDictionaryRef) -> i32;
        fn SecKeychainSetUserInteractionAllowed(allowed: u8) -> i32;
        fn SecKeychainGetUserInteractionAllowed(allowed: *mut u8) -> i32;
    }
    fn constant(value: CFStringRef) -> CFType {
        unsafe { CFString::wrap_under_get_rule(value) }.as_CFType()
    }
    fn access<T>(interactive: bool, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        // This legacy setting is process-wide. Serialize every Keychain operation
        // so an explicit Settings prompt cannot enable prompts in a background read.
        static OPERATIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _lock = OPERATIONS
            .lock()
            .map_err(|_| "credential_operation_failed")?;
        let mut previous = 0;
        if unsafe { SecKeychainGetUserInteractionAllowed(&mut previous) } != 0
            || unsafe { SecKeychainSetUserInteractionAllowed(u8::from(interactive)) } != 0
        {
            return Err("credential_operation_failed".into());
        }
        struct Restore(u8);
        impl Drop for Restore {
            fn drop(&mut self) {
                unsafe { SecKeychainSetUserInteractionAllowed(self.0) };
            }
        }
        let _restore = Restore(previous);
        work()
    }
    fn identity(target: &str, interactive: bool) -> Vec<(CFType, CFType)> {
        unsafe {
            vec![
                (constant(kSecClass), constant(kSecClassGenericPassword)),
                (constant(kSecAttrService), CFString::new(target).as_CFType()),
                (
                    constant(kSecAttrAccount),
                    CFString::new("OpenAI").as_CFType(),
                ),
                (
                    constant(kSecUseAuthenticationUI),
                    constant(if interactive {
                        kSecUseAuthenticationUIAllow
                    } else {
                        kSecUseAuthenticationUIFail
                    }),
                ),
            ]
        }
    }
    pub(super) fn read(target: &str) -> Result<Option<Zeroizing<String>>, String> {
        access(false, || read_item(target, false))
    }
    pub(super) fn unlock(target: &str) -> Result<bool, String> {
        access(true, || read_item(target, true).map(|key| key.is_some()))
    }
    fn read_item(target: &str, interactive: bool) -> Result<Option<Zeroizing<String>>, String> {
        let mut attributes = identity(target, interactive);
        unsafe {
            attributes.push((
                constant(kSecReturnData),
                CFBoolean::true_value().as_CFType(),
            ));
            attributes.push((constant(kSecMatchLimit), constant(kSecMatchLimitOne)));
        }
        let query = CFDictionary::from_CFType_pairs(&attributes);
        let mut result = std::ptr::null();
        let status = unsafe { SecItemCopyMatching(query.as_concrete_TypeRef(), &mut result) };
        if status == -25300 {
            return Ok(None);
        } // Item not found.
        if matches!(status, -25308 | -25293) {
            return Err("credential_access_denied".into());
        }
        if status != 0 || result.is_null() {
            return Err("credential_read_failed".into());
        }
        let item = unsafe { CFType::wrap_under_create_rule(result) };
        let data = item.downcast::<CFData>().ok_or("credential_invalid")?;
        if data.len() == 0 || data.len() as usize > MAX_KEY_BYTES {
            return Err("credential_invalid".into());
        }
        let bytes = Zeroizing::new(data.bytes().to_vec());
        let text = std::str::from_utf8(&bytes).map_err(|_| "credential_invalid")?;
        key_text(text).map_err(|_| "credential_invalid")?;
        Ok(Some(Zeroizing::new(text.to_owned())))
    }
    pub(super) fn write(target: &str, key: &str) -> Result<(), String> {
        access(true, || write_item(target, key))
    }
    fn write_item(target: &str, key: &str) -> Result<(), String> {
        let mut attributes = identity(target, true);
        let data = CFData::from_arc(std::sync::Arc::new(Zeroizing::new(
            key_text(key)?.as_bytes().to_vec(),
        )));
        let pair = unsafe { (constant(kSecValueData), data.as_CFType()) };
        let query = CFDictionary::from_CFType_pairs(&attributes);
        let update = CFDictionary::from_CFType_pairs(&[pair.clone()]);
        let mut status =
            unsafe { SecItemUpdate(query.as_concrete_TypeRef(), update.as_concrete_TypeRef()) };
        if status == -25300 {
            attributes.push(pair);
            let add = CFDictionary::from_CFType_pairs(&attributes);
            status = unsafe { SecItemAdd(add.as_concrete_TypeRef(), std::ptr::null_mut()) };
        }
        if status == 0 {
            // Updating an older item's data does not necessarily grant read access.
            // Never announce a usable saved key until this app can read it back.
            match read_item(target, true)? {
                Some(saved) if saved.as_str() == key_text(key)? => Ok(()),
                _ => Err("credential_write_failed".into()),
            }
        } else {
            Err("credential_write_failed".into())
        }
    }
    pub(super) fn delete(target: &str) -> Result<(), String> {
        access(true, || delete_item(target))
    }
    fn delete_item(target: &str) -> Result<(), String> {
        let query = CFDictionary::from_CFType_pairs(&identity(target, true));
        match unsafe { SecItemDelete(query.as_concrete_TypeRef()) } {
            0 | -25300 => Ok(()),
            _ => Err("credential_delete_failed".into()),
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod native {
    use super::*;
    pub(super) fn write(_: &str, _: &str) -> Result<(), String> {
        Err("credential_platform_unsupported".into())
    }
    pub(super) fn read(_: &str) -> Result<Option<Zeroizing<String>>, String> {
        Err("credential_platform_unsupported".into())
    }
    pub(super) fn delete(_: &str) -> Result<(), String> {
        Err("credential_platform_unsupported".into())
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
            native::delete(&target)?;
            assert!(native::read(&target)?.is_none());
            native::write(&target, "sk-disposable-original")?;
            assert!(native::read(&target)?.is_some_and(|key| *key == "sk-disposable-original"));
            native::write(&target, "sk-disposable-replaced")?;
            assert!(native::read(&target)?.is_some_and(|key| *key == "sk-disposable-replaced"));
            native::delete(&target)?;
            native::delete(&target)?;
            assert!(native::read(&target)?.is_none());
            Ok(())
        })();
        let cleanup = native::delete(&target);
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
                let _ = native::delete(&self.0);
            }
        }
        let _cleanup = Cleanup(target.clone());
        assert!(native::read(&target).unwrap().is_none());
        native::write(&target, "sk-disposable-credential-fixture").unwrap();
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
        native::write(&target, "sk-replacement-fixture").unwrap();
        let restored = native::read(&target).unwrap().unwrap();
        assert!(
            *restored == "sk-replacement-fixture",
            "Credential replacement failed"
        );
        native::delete(&target).unwrap();
        native::delete(&target).unwrap();
        assert!(native::read(&target).unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Child-process helper for windows_credential_restart_probe"]
    fn credential_restart_reader() {
        let target = std::env::var("YAPYAP_CREDENTIAL_PROBE_TARGET")
            .expect("Run windows_credential_restart_probe instead");
        assert!(target.starts_with(&format!("{TARGET}/probe-")));
        let restored = native::read(&target).unwrap().unwrap();
        assert!(
            *restored == "sk-disposable-credential-fixture",
            "Credential retrieval failed"
        );
    }
}
