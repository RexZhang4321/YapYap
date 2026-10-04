use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewWindow};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Hidden,
    Recording,
    Processing,
    Ready,
    Error,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub epoch: u32,
    pub revision: u32,
    pub phase: Phase,
}

#[derive(Default)]
pub struct OverlayState(pub Mutex<Snapshot>);

#[tauri::command]
pub fn claim_overlay(state: tauri::State<'_, OverlayState>) -> Result<Snapshot, &'static str> {
    let mut current = state.0.lock().map_err(|_| "overlay_unavailable")?;
    current.epoch = current.epoch.checked_add(1).ok_or("overlay_unavailable")?;
    current.revision = 0;
    Ok(*current)
}

fn is_newer(current: Snapshot, next: Snapshot) -> bool {
    next.epoch == current.epoch && next.revision > current.revision
}

#[tauri::command]
pub fn overlay_snapshot(state: tauri::State<'_, OverlayState>) -> Result<Snapshot, &'static str> {
    state
        .0
        .lock()
        .map(|value| *value)
        .map_err(|_| "overlay_unavailable")
}

fn position(window: &WebviewWindow) -> tauri::Result<()> {
    // Choose the foreground application's monitor, including its work area and
    // DPI. Fall back to the primary monitor when no foreground rect is available.
    #[cfg(windows)]
    let monitor = {
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
            )?
        } else {
            None
        }
    };
    #[cfg(not(windows))]
    let monitor = window.current_monitor()?;
    if let Some(monitor) = monitor.or(window.primary_monitor()?) {
        let area = monitor.work_area();
        let size = window.outer_size()?;
        let margin = (24.0 * monitor.scale_factor()).round() as i32;
        window.set_position(PhysicalPosition::new(
            area.position.x + (area.size.width as i32 - size.width as i32).max(0) / 2,
            area.position.y + (area.size.height as i32 - size.height as i32 - margin).max(0),
        ))?;
    }
    Ok(())
}

fn apply(app: &tauri::AppHandle, snapshot: Snapshot) -> Result<(), &'static str> {
    let state = app.state::<OverlayState>();
    let mut current = state.0.lock().map_err(|_| "overlay_unavailable")?;
    if !is_newer(*current, snapshot) {
        return Ok(());
    }
    let window = app
        .get_webview_window("overlay")
        .ok_or("overlay_unavailable")?;
    if snapshot.phase == Phase::Hidden {
        hide(&window).map_err(|_| "overlay_unavailable")?;
    } else {
        if current.phase == Phase::Hidden {
            position(&window).map_err(|_| "overlay_unavailable")?;
        }
        window
            .emit("overlay-state", snapshot)
            .map_err(|_| "overlay_unavailable")?;
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
            let hwnd = window.hwnd().map_err(|_| "overlay_unavailable")?;
            // Tauri's normal show path uses SW_SHOW. Explicitly avoid activation
            // on every show; the window is also nonfocusable and mouse-through.
            unsafe {
                ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
            }
        }
        #[cfg(not(windows))]
        window.show().map_err(|_| "overlay_unavailable")?;
    }
    *current = snapshot;
    Ok(())
}

pub fn hide(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        // Pair native show with native hide: the Tauri visibility cache was not
        // changed by ShowWindow(SW_SHOWNOACTIVATE).
        let hwnd = window.hwnd()?;
        unsafe {
            ShowWindow(hwnd.0 as _, SW_HIDE);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    window.hide()
}

#[tauri::command]
pub async fn update_overlay(app: tauri::AppHandle, snapshot: Snapshot) -> Result<(), &'static str> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(apply(&handle, snapshot));
    })
    .map_err(|_| "overlay_unavailable")?;
    receive.await.map_err(|_| "overlay_unavailable")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_accept_only_fixed_states_and_no_text() {
        assert!(
            serde_json::from_str::<Snapshot>(r#"{"epoch":1,"revision":1,"phase":"unknown"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"epoch":1,"revision":1,"phase":"recording"}"#
        )
        .is_ok());
        let value = serde_json::to_value(Snapshot {
            epoch: 1,
            revision: 2,
            phase: Phase::Error,
        })
        .unwrap();
        assert_eq!(value.as_object().unwrap().len(), 3);
        assert_eq!(value["phase"], "error");
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"epoch":1,"revision":1,"phase":"recording","text":"secret"}"#
        )
        .is_err());
    }

    #[test]
    fn old_page_updates_cannot_override_a_reload_or_newer_discard() {
        let current = Snapshot {
            epoch: 2,
            revision: 1,
            phase: Phase::Hidden,
        };
        assert!(!is_newer(
            current,
            Snapshot {
                epoch: 1,
                revision: 100,
                phase: Phase::Recording
            }
        ));
        assert!(!is_newer(
            current,
            Snapshot {
                epoch: 2,
                revision: 1,
                phase: Phase::Recording
            }
        ));
        assert!(is_newer(
            current,
            Snapshot {
                epoch: 2,
                revision: 2,
                phase: Phase::Recording
            }
        ));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Read-only window metadata; requires the development app to be running"]
    fn windows_overlay_observation() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, IsWindowVisible,
            GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
        };
        let title: Vec<u16> = "BYOK Dictation — Overlay"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
        assert!(!hwnd.is_null(), "Development overlay window not found");
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
        let mut rect = windows_sys::Win32::Foundation::RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect);
        }
        println!(
            "TASK8_WINDOW {}",
            serde_json::json!({
                "foreground": unsafe { GetForegroundWindow() } as usize,
                "overlay": hwnd as usize,
                "visible": unsafe { IsWindowVisible(hwnd) } != 0,
                "noActivate": style & WS_EX_NOACTIVATE != 0,
                "topmost": style & WS_EX_TOPMOST != 0,
                "mouseThrough": style & WS_EX_TRANSPARENT != 0,
                "rect": [rect.left, rect.top, rect.right, rect.bottom],
            })
        );
    }
}
