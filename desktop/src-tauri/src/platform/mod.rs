//! Compile-time selection of native platform implementations.
#[cfg(windows)]
#[path = "../insertion.rs"]
pub(crate) mod insertion;
#[cfg(not(windows))]
#[path = "../insertion_unsupported.rs"]
pub(crate) mod insertion;
