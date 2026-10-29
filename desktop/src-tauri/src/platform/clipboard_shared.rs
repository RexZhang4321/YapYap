//! Clipboard observation contract. Callers must hold the platform's required
//! lock or run on its required thread; snapshots keep native formats opaque.
pub(crate) trait ClipboardAdapter {
    type Snapshot;
    type Revision: Copy + Eq;
    fn snapshot() -> Result<Self::Snapshot, String>;
    fn revision() -> Self::Revision;
    fn contains_text(expected: &str) -> bool;
    // Must recheck the revision at the native write boundary.
    fn restore(snapshot: &Self::Snapshot, revision: Self::Revision) -> Result<(), String>;
}

// This check does not make a later restore atomic. Each adapter must protect or
// recheck the actual write according to the OS clipboard's concurrency rules.
pub(crate) fn still_owned<C: ClipboardAdapter>(revision: C::Revision, text: &str) -> bool {
    C::revision() == revision && C::contains_text(text)
}

pub(crate) fn restore_if_owned<C: ClipboardAdapter>(
    snapshot: &C::Snapshot,
    revision: C::Revision,
    text: &str,
) -> Result<bool, String> {
    if !still_owned::<C>(revision, text) {
        return Ok(false);
    }
    C::restore(snapshot, revision)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture;
    impl ClipboardAdapter for Fixture {
        type Snapshot = ();
        type Revision = u32;
        fn snapshot() -> Result<(), String> {
            Ok(())
        }
        fn revision() -> u32 {
            7
        }
        fn contains_text(expected: &str) -> bool {
            expected == "ours"
        }
        fn restore(_: &(), _: u32) -> Result<(), String> {
            Ok(())
        }
    }
    #[test]
    fn restoration_requires_our_revision_and_our_text() {
        assert!(still_owned::<Fixture>(7, "ours"));
        assert!(!still_owned::<Fixture>(8, "ours"));
        assert!(!still_owned::<Fixture>(7, "newer copy"));
        assert!(restore_if_owned::<Fixture>(&(), 7, "ours").unwrap());
        assert!(!restore_if_owned::<Fixture>(&(), 8, "ours").unwrap());
    }
}
