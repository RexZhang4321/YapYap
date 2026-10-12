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

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Preview {
    #[default]
    Off,
    Connecting,
    Listening,
    Finishing,
    Completed,
    Failed,
}

const MAX_OVERLAY_TEXT: usize = 2048; // Same UTF-16 budget as the frontend.

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub epoch: u32,
    pub revision: u32,
    pub phase: Phase,
    pub text: String,
    pub preview: Preview,
    #[serde(rename = "hasGap")]
    pub has_gap: bool,
}

impl Snapshot {
    fn validate(&self) -> Result<(), &'static str> {
        if self.text.encode_utf16().count() > MAX_OVERLAY_TEXT
            || ((self.phase == Phase::Hidden || self.preview == Preview::Off)
                && (!self.text.is_empty() || self.has_gap))
            || (self.phase == Phase::Hidden && self.preview != Preview::Off)
        {
            return Err("overlay_payload_invalid");
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct OverlayState(pub Mutex<Snapshot>);

#[tauri::command]
pub fn claim_overlay(state: tauri::State<'_, OverlayState>) -> Result<Snapshot, &'static str> {
    let mut current = state.0.lock().map_err(|_| "overlay_unavailable")?;
    current.epoch = current.epoch.checked_add(1).ok_or("overlay_unavailable")?;
    current.revision = 0;
    Ok(current.clone())
}

fn is_newer(current: &Snapshot, next: &Snapshot) -> bool {
    next.epoch == current.epoch && next.revision > current.revision
}

#[tauri::command]
pub fn overlay_snapshot(state: tauri::State<'_, OverlayState>) -> Result<Snapshot, &'static str> {
    state
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "overlay_unavailable")
}

#[cfg(target_os = "macos")]
fn foreground_point() -> Option<(f64, f64)> {
    use core_foundation::{
        array::{CFArray, CFArrayRef},
        base::{CFType, TCFType},
        dictionary::CFDictionary,
        number::CFNumber,
        string::CFString,
    };
    use objc2::{class, msg_send, runtime::AnyObject};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(options: u32, relative_to: u32) -> CFArrayRef;
    }
    fn value(dictionary: &CFDictionary, key: &str) -> Option<CFType> {
        let key = CFString::new(key);
        dictionary
            .find(key.as_CFTypeRef())
            .map(|value| unsafe { CFType::wrap_under_get_rule(*value) })
    }
    fn number(dictionary: &CFDictionary, key: &str) -> Option<f64> {
        value(dictionary, key)?.downcast::<CFNumber>()?.to_f64()
    }
    // Called on the main thread. Read geometry/PID only, never window titles.
    let pid: i32 = unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let application: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if application.is_null() {
            return None;
        }
        msg_send![application, processIdentifier]
    };
    let list = unsafe { CGWindowListCopyWindowInfo(1 | 16, 0) }; // On-screen, exclude desktop.
    if list.is_null() {
        return None;
    }
    let windows = unsafe { CFArray::<CFType>::wrap_under_create_rule(list) };
    for item in windows.iter() {
        let Some(window) = item.downcast::<CFDictionary>() else {
            continue;
        };
        if number(&window, "kCGWindowOwnerPID") != Some(pid as f64)
            || number(&window, "kCGWindowLayer") != Some(0.0)
        {
            continue;
        }
        let bounds = value(&window, "kCGWindowBounds")?.downcast::<CFDictionary>()?;
        let x = number(&bounds, "X")? + number(&bounds, "Width")? / 2.0;
        let y = number(&bounds, "Y")? + number(&bounds, "Height")? / 2.0;
        return (x.is_finite() && y.is_finite()).then_some((x, y));
    }
    None
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
    #[cfg(target_os = "macos")]
    let monitor = foreground_point().and_then(|(x, y)| {
        window
            .available_monitors()
            .ok()?
            .into_iter()
            .find(|monitor| {
                // CoreGraphics window bounds are in points; Tauri uses physical pixels.
                let origin = monitor.position().to_logical::<f64>(monitor.scale_factor());
                let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
                x >= origin.x
                    && x < origin.x + size.width
                    && y >= origin.y
                    && y < origin.y + size.height
            })
    });
    #[cfg(not(any(windows, target_os = "macos")))]
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
    if !is_newer(&current, &snapshot) {
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
            .emit("overlay-state", &snapshot)
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
        #[cfg(target_os = "macos")]
        unsafe {
            // Tauri/tao show() calls makeKeyAndOrderFront on Mac. Order the
            // passive window without making it key or activating the app.
            let native = window.ns_window().map_err(|_| "overlay_unavailable")?
                as *mut objc2::runtime::AnyObject;
            let _: () = objc2::msg_send![native, orderFrontRegardless];
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        window.show().map_err(|_| "overlay_unavailable")?;
    }
    // Clear the hidden WebView's text too, so discarded previews are not kept
    // in its DOM and delayed events cannot restore them.
    if snapshot.phase == Phase::Hidden {
        window
            .emit("overlay-state", &snapshot)
            .map_err(|_| "overlay_unavailable")?;
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
    snapshot.validate()?;
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
    fn snapshots_accept_bounded_preview_only_and_reject_unknown_fields() {
        assert!(
            serde_json::from_str::<Snapshot>(r#"{"epoch":1,"revision":1,"phase":"unknown"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"epoch":1,"revision":1,"phase":"recording","text":"你好 😀","preview":"listening","hasGap":false}"#
        )
        .is_ok());
        let value = serde_json::to_value(Snapshot {
            epoch: 1,
            revision: 2,
            phase: Phase::Error,
            ..Snapshot::default()
        })
        .unwrap();
        assert_eq!(value.as_object().unwrap().len(), 6);
        assert_eq!(value["phase"], "error");
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"epoch":1,"revision":1,"phase":"recording","text":"","preview":"off","hasGap":false,"apiKey":"fixture"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"epoch":1,"revision":1,"phase":"recording","text":"","preview":"unknown","hasGap":false}"#
        ).is_err());
        let mut snapshot = Snapshot {
            phase: Phase::Recording,
            preview: Preview::Listening,
            text: "😀".repeat(MAX_OVERLAY_TEXT / 2),
            ..Snapshot::default()
        };
        assert!(snapshot.validate().is_ok());
        snapshot.text.push('a');
        assert_eq!(snapshot.validate(), Err("overlay_payload_invalid"));
        snapshot.text = "retained preview".into();
        snapshot.phase = Phase::Hidden;
        assert!(snapshot.validate().is_err());
        snapshot.phase = Phase::Recording;
        snapshot.preview = Preview::Off;
        assert!(snapshot.validate().is_err());
        snapshot.text.clear();
        snapshot.has_gap = true;
        assert!(snapshot.validate().is_err());
        snapshot.has_gap = false;
        assert!(snapshot.validate().is_ok());
    }

    #[test]
    fn old_page_updates_cannot_override_a_reload_or_newer_discard() {
        let current = Snapshot {
            epoch: 2,
            revision: 1,
            phase: Phase::Hidden,
            ..Snapshot::default()
        };
        assert!(!is_newer(
            &current,
            &Snapshot {
                epoch: 1,
                revision: 100,
                phase: Phase::Recording,
                text: "old preview".into(),
                preview: Preview::Listening,
                ..Snapshot::default()
            }
        ));
        assert!(!is_newer(
            &current,
            &Snapshot {
                epoch: 2,
                revision: 1,
                phase: Phase::Recording,
                ..Snapshot::default()
            }
        ));
        assert!(is_newer(
            &current,
            &Snapshot {
                epoch: 2,
                revision: 2,
                phase: Phase::Recording,
                ..Snapshot::default()
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
        let title: Vec<u16> = "YapYap — Overlay".encode_utf16().chain(Some(0)).collect();
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
