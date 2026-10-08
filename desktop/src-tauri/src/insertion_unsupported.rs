//! Fail-closed shell for platforms whose destination/clipboard adapters are unproven.
use tauri::State;

const UNAVAILABLE: &str = "Automatic insertion and clipboard recovery are unavailable in this platform probe. No paste or clipboard change was made.";

#[derive(Default)]
pub struct ProbeState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertionResult {
    paste_attempted: bool,
    paste_sent: bool,
    clipboard_restored: bool,
    message: String,
}

#[tauri::command]
pub fn capture_target(state: State<'_, ProbeState>) -> Result<String, String> {
    let _ = state;
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn capture_dictation_target(
    session_id: String,
    state: State<'_, ProbeState>,
) -> Result<(), String> {
    let _ = (session_id, state);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn discard_dictation_target(
    session_id: String,
    state: State<'_, ProbeState>,
) -> Result<(), String> {
    // There can be no captured destination or pending clipboard backup here.
    let _ = (session_id, state);
    Ok(())
}

fn refused() -> InsertionResult {
    InsertionResult {
        paste_attempted: false,
        paste_sent: false,
        clipboard_restored: false,
        message: UNAVAILABLE.into(),
    }
}

#[tauri::command]
pub fn insert_dictation_text(
    session_id: String,
    text: String,
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> InsertionResult {
    let _ = (session_id, text, window, state);
    refused()
}

#[tauri::command]
pub fn insert_test_text(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let _ = (window, state);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn copy_dictation_text(
    text: String,
    without_backup: bool,
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let _ = (text, without_backup, window, state);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn copy_test_text(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let _ = (window, state);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn copy_test_text_without_backup(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let _ = (window, state);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn restore_previous_clipboard(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let _ = (window, state);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn has_clipboard_backup(state: State<'_, ProbeState>) -> Result<bool, String> {
    let _ = state;
    Ok(false)
}

#[cfg(test)]
mod tests {
    #[test]
    fn unsupported_insertion_preserves_refusal_contract() {
        let result = serde_json::to_value(super::refused()).unwrap();
        assert_eq!(result["pasteAttempted"], false);
        assert_eq!(result["pasteSent"], false);
        assert_eq!(result["clipboardRestored"], false);
        assert!(result["message"].as_str().unwrap().contains("unavailable"));
    }
}
