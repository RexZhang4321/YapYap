//! Platform-independent insertion safety rules and result contract.

// Calls must run on the platform's required thread. The target is deliberately
// opaque: each OS captures the metadata needed to validate its own destination.
pub(crate) trait DestinationAdapter {
    type Target;
    fn capture() -> Result<Self::Target, String>;
    fn verify(target: &Self::Target) -> Result<(), String>;
    fn dispatch_paste() -> Result<(), String>;
}

pub(crate) struct DictationTarget<T> {
    pub(crate) session_id: String,
    pub(crate) target: T,
    pub(crate) paste_attempted: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertionResult {
    pub(crate) paste_attempted: bool,
    pub(crate) paste_sent: bool,
    pub(crate) clipboard_restored: bool,
    pub(crate) message: String,
}

impl InsertionResult {
    pub(crate) fn refused(message: impl Into<String>) -> Self {
        Self {
            paste_attempted: false,
            paste_sent: false,
            clipboard_restored: false,
            message: message.into(),
        }
    }
}

pub(crate) fn validate_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() || text.contains('\0') || text.len() > 1024 * 1024 {
        return Err("Text is empty, contains NUL, or exceeds the insertion limit. Use the transcript view to recover it.".into());
    }
    Ok(())
}

pub(crate) fn claim_paste<T>(
    dictation: &mut Option<DictationTarget<T>>,
    session_id: &str,
) -> Result<(), String> {
    let captured = dictation
        .as_mut()
        .filter(|item| item.session_id == session_id)
        .ok_or("This dictation destination is no longer available. Use Copy.")?;
    if captured.paste_attempted {
        return Err("Paste was already attempted. Use Copy to avoid duplicate insertion.".into());
    }
    captured.paste_attempted = true;
    Ok(())
}

pub(crate) fn insertion_outcome(
    paste: Result<(), String>,
    restored: Result<bool, String>,
) -> InsertionResult {
    let message = match (&paste, &restored) {
        (Ok(()), Ok(true)) => "Paste keystrokes sent; previous clipboard restored. Check the target.",
        (Ok(()), Ok(false)) => "Paste sent; newer clipboard contents were preserved. Check the target.",
        (Ok(()), Err(_)) => "Paste sent; clipboard restore is pending. Use Restore previous clipboard; do not insert again.",
        (Err(_), _) => "Paste outcome is uncertain. Check the target before using Copy. Automatic insertion will not repeat.",
    };
    InsertionResult {
        paste_attempted: true,
        paste_sent: paste.is_ok(),
        clipboard_restored: matches!(restored, Ok(true)),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_claim_never_allows_a_stale_or_repeated_paste() {
        let mut target = Some(DictationTarget {
            session_id: "current".into(),
            target: (),
            paste_attempted: false,
        });
        assert!(claim_paste(&mut target, "stale").is_err());
        assert!(!target.as_ref().unwrap().paste_attempted);
        assert!(claim_paste(&mut target, "current").is_ok());
        assert!(claim_paste(&mut target, "current").is_err());
        target = None;
        assert!(claim_paste(&mut target, "current").is_err());
    }

    #[test]
    fn uncertain_paste_and_restore_failure_are_never_refusals() {
        for (paste, restore) in [
            (Err("failed".into()), Ok(true)),
            (Ok(()), Err("failed".into())),
        ] {
            assert!(insertion_outcome(paste, restore).paste_attempted);
        }
        assert!(!InsertionResult::refused("changed").paste_attempted);
    }
}
