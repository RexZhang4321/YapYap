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

pub(super) fn unlock(target: &str) -> Result<bool, String> {
    read(target).map(|key| key.is_some())
}
