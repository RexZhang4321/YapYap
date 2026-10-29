use tauri::WebviewWindow;
pub(super) fn foreground_monitor(
    window: &WebviewWindow,
) -> tauri::Result<Option<tauri::window::Monitor>> {
    window.current_monitor()
}
pub(super) fn show_passive(window: &WebviewWindow) -> tauri::Result<()> {
    window.show()
}
pub(super) fn hide(window: &WebviewWindow) -> tauri::Result<()> {
    window.hide()
}
