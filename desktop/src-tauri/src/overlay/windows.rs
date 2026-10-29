use tauri::WebviewWindow;

pub(super) fn foreground_monitor(
    window: &WebviewWindow,
) -> tauri::Result<Option<tauri::window::Monitor>> {
    {
        use windows_sys::Win32::{
            Foundation::RECT,
            UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect},
        };
        let mut rect = RECT::default();
        let valid = unsafe { GetWindowRect(GetForegroundWindow(), &mut rect) } != 0;
        if valid {
            window.monitor_from_point(
                (rect.left as f64 + rect.right as f64) / 2.0,
                (rect.top as f64 + rect.bottom as f64) / 2.0,
            )
        } else {
            Ok(None)
        }
    }
}

pub(super) fn show_passive(window: &WebviewWindow) -> tauri::Result<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    let hwnd = window.hwnd()?;
    unsafe {
        ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
    }
    Ok(())
}

pub(super) fn hide(window: &WebviewWindow) -> tauri::Result<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    let hwnd = window.hwnd()?;
    unsafe {
        ShowWindow(hwnd.0 as _, SW_HIDE);
    }
    Ok(())
}
