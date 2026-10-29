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
