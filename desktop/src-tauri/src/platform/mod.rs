//! Compile-time selection of native platform implementations.
pub(crate) mod clipboard_shared;
#[cfg(windows)]
#[path = "../insertion.rs"]
pub(crate) mod insertion;
#[cfg(target_os = "macos")]
pub(crate) mod insertion_macos;
pub(crate) mod insertion_shared;
#[cfg(target_os = "macos")]
pub(crate) use insertion_macos as insertion;
#[cfg(not(any(windows, target_os = "macos")))]
#[path = "../insertion_unsupported.rs"]
pub(crate) mod insertion;
