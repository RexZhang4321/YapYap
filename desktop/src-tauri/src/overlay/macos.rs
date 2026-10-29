use tauri::WebviewWindow;

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

pub(super) fn foreground_monitor(
    window: &WebviewWindow,
) -> tauri::Result<Option<tauri::window::Monitor>> {
    Ok(foreground_point().and_then(|(x, y)| {
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
    }))
}

pub(super) fn show_passive(window: &WebviewWindow) -> tauri::Result<()> {
    let native = window.ns_window()? as *mut objc2::runtime::AnyObject;
    unsafe {
        let _: () = objc2::msg_send![native, orderFrontRegardless];
    }
    Ok(())
}

pub(super) fn hide(window: &WebviewWindow) -> tauri::Result<()> {
    window.hide()
}
