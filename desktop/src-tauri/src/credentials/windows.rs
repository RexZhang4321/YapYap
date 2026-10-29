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

pub(super) fn unlock(target: &str) -> Result<bool, String> {
    read(target).map(|key| key.is_some())
}
