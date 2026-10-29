//! macOS destination guards and multi-item clipboard recovery. AppKit work is
//! dispatched to the main thread; modifier/consumer waits never block that thread.
use crate::platform::insertion_shared::{
    claim_paste, insertion_outcome, validate_text, DestinationAdapter, DictationTarget,
    InsertionResult,
};
use core_foundation::{
    base::{CFEqual, CFGetTypeID, CFRelease, CFRetain, CFTypeRef, TCFType},
    string::CFString,
};
use objc2::{class, msg_send, rc::autoreleasepool, runtime::AnyObject};
use std::{ffi::c_void, ptr, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};

pub const TEST_TEXT: &str = "YapYap dictation insertion probe\n你好 😀 — café\nsecond line";
const MAX_CLIPBOARD_BYTES: usize = 64 * 1024 * 1024;
const MAX_ITEMS: usize = 128;
const MAX_FORMATS: usize = 128;
const MODIFIERS: u64 = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20); // Shift/Control/Option/Command
const ACCESS_HELP: &str = "Allow YapYap in System Settings → Privacy & Security → Accessibility, then try again. No paste or clipboard change was made.";

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
struct Range {
    location: isize,
    length: isize,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementGetTypeID() -> usize;
    fn AXUIElementSetMessagingTimeout(element: CFTypeRef, seconds: f32) -> i32;
    fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        name: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetValue(value: CFTypeRef, kind: u32, output: *mut c_void) -> u8;
}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightPostEventAccess() -> bool;
    fn CGEventCreate(source: CFTypeRef) -> CFTypeRef;
    fn CGEventGetLocation(event: CFTypeRef) -> Point;
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventCreateKeyboardEvent(source: CFTypeRef, key: u16, down: bool) -> CFTypeRef;
    fn CGEventSetFlags(event: CFTypeRef, flags: u64);
    fn CGEventPost(tap: u32, event: CFTypeRef);
}

// Owned immutable CF objects (AX remote handles and CG events). CF retain/release
// are thread-safe. Only our main-thread callbacks message AX/AppKit objects.
// Store an opaque address so no Objective-C pointer escapes a callback.
struct OwnedCf(usize);
impl OwnedCf {
    unsafe fn new(value: CFTypeRef) -> Result<Self, String> {
        if value.is_null() {
            Err("Native destination information is unavailable. Use Copy.".into())
        } else {
            Ok(Self(value as usize))
        }
    }
    fn raw(&self) -> CFTypeRef {
        self.0 as CFTypeRef
    }
}
impl Clone for OwnedCf {
    fn clone(&self) -> Self {
        unsafe {
            CFRetain(self.raw());
        }
        Self(self.0)
    }
}
impl Drop for OwnedCf {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.raw());
        }
    }
}
impl PartialEq for OwnedCf {
    fn eq(&self, other: &Self) -> bool {
        unsafe { CFEqual(self.raw(), other.raw()) != 0 }
    }
}

#[derive(Clone)]
struct Target {
    pid: i32,
    window: OwnedCf,
    focus: OwnedCf,
    selection: Range,
    mouse: Point,
}
#[derive(Clone, Default, Debug, PartialEq)]
struct ClipboardSnapshot(Vec<Vec<(String, Vec<u8>)>>);
struct Recovery {
    previous: ClipboardSnapshot,
    ours: String,
    sequence: isize,
}

#[derive(Default)]
struct ProbeData {
    target: Option<Target>,
    dictation: Option<DictationTarget<Target>>,
    recovery: Option<Recovery>,
}
#[derive(Default)]
pub struct ProbeState {
    data: Mutex<ProbeData>,
    operation: tokio::sync::Mutex<()>,
}

async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(autoreleasepool(|_| work(&handle)));
    })
    .map_err(|_| "The app is unavailable.")?;
    receive
        .await
        .map_err(|_| "The app is unavailable.".to_string())?
}

fn attribute(element: &OwnedCf, name: &str) -> Result<OwnedCf, String> {
    let name = CFString::new(name);
    let mut value = ptr::null();
    let status =
        unsafe { AXUIElementCopyAttributeValue(element.raw(), name.as_CFTypeRef(), &mut value) };
    if status != 0 {
        if !value.is_null() {
            unsafe {
                CFRelease(value);
            }
        }
        return Err("The focused input or text cursor cannot be checked. Enable accessibility support in the destination app, then retry, or use Copy.".into());
    }
    unsafe { OwnedCf::new(value) }
}
fn ax_element(value: OwnedCf) -> Result<OwnedCf, String> {
    if unsafe { CFGetTypeID(value.raw()) != AXUIElementGetTypeID() } {
        return Err("The focused input cannot be identified. Use Copy.".into());
    }
    Ok(value)
}
struct NativeDestination;
impl DestinationAdapter for NativeDestination {
    type Target = Target;
    fn capture() -> Result<Target, String> {
        target()
    }
    fn verify(original: &Target) -> Result<(), String> {
        same_target(original)
    }
    fn dispatch_paste() -> Result<(), String> {
        paste()
    }
}

fn target() -> Result<Target, String> {
    if !unsafe { AXIsProcessTrusted() && CGPreflightPostEventAccess() } {
        return Err(ACCESS_HELP.into());
    }
    let pid: i32 = unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let application: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if application.is_null() {
            return Err("No foreground application was found.".into());
        }
        msg_send![application, processIdentifier]
    };
    if pid == std::process::id() as i32 {
        return Err("Focus your intended text field before pressing the shortcut.".into());
    }
    let app = unsafe { OwnedCf::new(AXUIElementCreateApplication(pid))? };
    unsafe {
        AXUIElementSetMessagingTimeout(app.raw(), 0.3);
    }
    let window = ax_element(attribute(&app, "AXFocusedWindow")?)?;
    let focus = ax_element(attribute(&app, "AXFocusedUIElement")?)?;
    // Read selection offsets only: never AXValue/AXSelectedText or window titles.
    // A missing selection is a refusal, rather than an unguarded paste.
    let value = attribute(&focus, "AXSelectedTextRange")?;
    let mut selection = Range::default();
    if unsafe {
        CFGetTypeID(value.raw()) != AXValueGetTypeID()
            || AXValueGetValue(value.raw(), 4, &mut selection as *mut _ as _) == 0
    } || selection.location < 0
        || selection.length < 0
    {
        return Err("The destination does not expose its text cursor. Enable its accessibility support or use Copy.".into());
    }
    let event = unsafe { OwnedCf::new(CGEventCreate(ptr::null()))? };
    let mouse = unsafe { CGEventGetLocation(event.raw()) };
    if !mouse.x.is_finite() || !mouse.y.is_finite() {
        return Err("The pointer position could not be read.".into());
    }
    Ok(Target {
        pid,
        window,
        focus,
        selection,
        mouse,
    })
}
fn guard_matches(
    app: bool,
    input: bool,
    selection: Range,
    original_selection: Range,
    mouse: Point,
    original_mouse: Point,
) -> Result<(), String> {
    if !app || !input {
        return Err("Focused application or input changed; text was kept for Copy.".into());
    }
    if mouse != original_mouse {
        return Err("Pointer moved; text was kept for Copy.".into());
    }
    if selection != original_selection {
        return Err("Text cursor moved; text was kept for Copy.".into());
    }
    Ok(())
}
fn same_target(original: &Target) -> Result<(), String> {
    let current = target()?;
    guard_matches(
        current.pid == original.pid && current.window == original.window,
        current.focus == original.focus,
        current.selection,
        original.selection,
        current.mouse,
        original.mouse,
    )
}

unsafe fn board() -> *mut AnyObject {
    msg_send![class!(NSPasteboard), generalPasteboard]
}
fn sequence() -> isize {
    unsafe { msg_send![board(), changeCount] }
}
unsafe fn ns_string(text: &str) -> *mut AnyObject {
    // CFString is toll-free bridged to NSString; return an autoreleased retain.
    let value = CFString::new(text);
    let object = value.as_CFTypeRef() as *mut AnyObject;
    let object: *mut AnyObject = msg_send![object, retain];
    msg_send![object, autorelease]
}
unsafe fn string_value(value: *mut AnyObject) -> Result<String, String> {
    if value.is_null() {
        return Err("A clipboard format could not be read.".into());
    }
    let value = CFString::wrap_under_get_rule(value as _);
    Ok(value.to_string())
}
fn unsupported_clipboard_type(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("filepromise")
        || name.contains("filespromise")
        || name.contains("file-promise")
        || name.starts_with("com.apple.pasteboard.promised-file-")
}
fn read_clipboard() -> Result<ClipboardSnapshot, String> {
    unsafe {
        let before = sequence();
        let items: *mut AnyObject = msg_send![board(), pasteboardItems];
        if items.is_null() {
            let types: *mut AnyObject = msg_send![board(), types];
            let count: usize = if types.is_null() {
                0
            } else {
                msg_send![types, count]
            };
            if count != 0 {
                return Err(
                    "Clipboard contents cannot be backed up. Use Replace clipboard explicitly."
                        .into(),
                );
            }
            return Ok(ClipboardSnapshot::default());
        }
        let count: usize = msg_send![items, count];
        if count == 0 {
            let types: *mut AnyObject = msg_send![board(), types];
            let count: usize = if types.is_null() {
                0
            } else {
                msg_send![types, count]
            };
            if count != 0 {
                return Err(
                    "Clipboard contents cannot be backed up. Use Replace clipboard explicitly."
                        .into(),
                );
            }
        }
        if count > MAX_ITEMS {
            return Err("Clipboard has too many items to back up.".into());
        }
        let mut snapshot = Vec::new();
        let mut total = 0usize;
        let mut formats = 0usize;
        for index in 0..count {
            let item: *mut AnyObject = msg_send![items, objectAtIndex: index];
            let types: *mut AnyObject = msg_send![item, types];
            let count: usize = msg_send![types, count];
            formats = formats.saturating_add(count);
            if count == 0 || formats > MAX_FORMATS {
                return Err("Clipboard formats cannot be safely backed up.".into());
            }
            let mut saved = Vec::new();
            for index in 0..count {
                let kind: *mut AnyObject = msg_send![types, objectAtIndex: index];
                let name = string_value(kind)?;
                // File promises describe a provider operation, not durable data.
                if unsupported_clipboard_type(&name) {
                    return Err(
                        "Clipboard contains promised files. Use Replace clipboard explicitly."
                            .into(),
                    );
                }
                let data: *mut AnyObject = msg_send![item, dataForType: kind];
                if data.is_null() {
                    return Err("A clipboard format could not be backed up. Use Replace clipboard explicitly.".into());
                }
                let length: usize = msg_send![data, length];
                total = total.saturating_add(length);
                if total > MAX_CLIPBOARD_BYTES {
                    return Err("Clipboard exceeds the 64 MiB backup limit.".into());
                }
                let bytes: *const u8 = msg_send![data, bytes];
                let content = if length == 0 {
                    Vec::new()
                } else {
                    if bytes.is_null() {
                        return Err("A clipboard format could not be backed up.".into());
                    }
                    std::slice::from_raw_parts(bytes, length).to_vec()
                };
                saved.push((name, content));
            }
            snapshot.push(saved);
        }
        if sequence() != before {
            return Err("Clipboard changed during backup. Try again.".into());
        }
        Ok(ClipboardSnapshot(snapshot))
    }
}
// Construct every item before clearing. The expected change count guards reads,
// delayed providers and restores; NSPasteboard has no atomic compare-and-swap.
fn write_clipboard(snapshot: &ClipboardSnapshot, expected: isize) -> Result<isize, String> {
    write_clipboard_with_status(snapshot, expected, &mut false)
}
fn write_clipboard_with_status(
    snapshot: &ClipboardSnapshot,
    expected: isize,
    cleared: &mut bool,
) -> Result<isize, String> {
    unsafe {
        let objects: *mut AnyObject = msg_send![class!(NSMutableArray), array];
        for saved in &snapshot.0 {
            let item: *mut AnyObject = msg_send![class!(NSPasteboardItem), new];
            let item: *mut AnyObject = msg_send![item, autorelease];
            for (name, bytes) in saved {
                let data: *mut AnyObject =
                    msg_send![class!(NSData), dataWithBytes: bytes.as_ptr(), length: bytes.len()];
                let ok: bool = msg_send![item, setData: data, forType: ns_string(name)];
                if !ok {
                    return Err("A clipboard format could not be prepared.".into());
                }
            }
            let _: () = msg_send![objects, addObject: item];
        }
        if sequence() != expected {
            return Err("Clipboard changed; newer contents were preserved.".into());
        }
        let changed: isize = msg_send![board(), clearContents];
        *cleared = true;
        if sequence() != changed {
            return Err("Clipboard changed; newer contents were preserved.".into());
        }
        if !snapshot.0.is_empty() {
            let ok: bool = msg_send![board(), writeObjects: objects];
            if !ok {
                return Err("Clipboard could not be written. Previous clipboard remains available for Restore.".into());
            }
        }
        Ok(sequence())
    }
}
fn clipboard_contains_text(expected: &str) -> bool {
    unsafe {
        let value: *mut AnyObject =
            msg_send![board(), stringForType: ns_string("public.utf8-plain-text")];
        string_value(value).is_ok_and(|text| text == expected)
    }
}
fn plain_text(text: &str) -> ClipboardSnapshot {
    ClipboardSnapshot(vec![vec![(
        "public.utf8-plain-text".into(),
        text.as_bytes().to_vec(),
    )]])
}
fn put_text(state: &ProbeState, text: &str, without_backup: bool) -> Result<(), String> {
    let mut data = state
        .data
        .lock()
        .map_err(|_| "Insertion state is unavailable.")?;
    if data.recovery.is_some() {
        return Err("Restore the previous clipboard before copying or inserting again.".into());
    }
    let before = sequence();
    let previous = if without_backup {
        None
    } else {
        Some(read_clipboard()?)
    };
    if let Some(previous) = previous {
        data.recovery = Some(Recovery {
            previous,
            ours: text.into(),
            sequence: before,
        });
    }
    let mut cleared = false;
    match write_clipboard_with_status(&plain_text(text), before, &mut cleared) {
        Ok(sequence) => {
            if let Some(recovery) = data.recovery.as_mut() {
                recovery.sequence = sequence;
            }
            Ok(())
        }
        Err(error) => {
            // A failure before clear leaves the clipboard intact, including a
            // concurrent newer copy. Only a destructive failure needs Restore.
            if !cleared {
                data.recovery = None;
            }
            Err(error)
        }
    }
}
fn restore_automatic(state: &ProbeState) -> Result<bool, String> {
    let mut data = state
        .data
        .lock()
        .map_err(|_| "Insertion state is unavailable.")?;
    let saved = data
        .recovery
        .as_ref()
        .ok_or("No clipboard backup is pending.")?;
    if sequence() != saved.sequence || !clipboard_contains_text(&saved.ours) {
        data.recovery = None;
        return Ok(false);
    }
    write_clipboard(&saved.previous, saved.sequence)?;
    data.recovery = None;
    Ok(true)
}
fn paste() -> Result<(), String> {
    if !unsafe { AXIsProcessTrusted() && CGPreflightPostEventAccess() } {
        return Err(ACCESS_HELP.into());
    }
    // Allocate both events before posting either. Posting is void: acceptance by
    // the destination is never claimed and the session latch prevents repeats.
    let down = unsafe { OwnedCf::new(CGEventCreateKeyboardEvent(ptr::null(), 9, true))? };
    let up = unsafe { OwnedCf::new(CGEventCreateKeyboardEvent(ptr::null(), 9, false))? };
    unsafe {
        CGEventSetFlags(down.raw(), 1 << 20);
        CGEventSetFlags(up.raw(), 1 << 20);
        CGEventPost(0, down.raw());
        CGEventPost(0, up.raw());
    }
    Ok(())
}

async fn insert_text(
    app: &AppHandle,
    original: Target,
    text: String,
    session_id: Option<String>,
) -> Result<InsertionResult, String> {
    validate_text(&text)?;
    let state = app.state::<ProbeState>();
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Clipboard operation is busy. Try again.")?;
    let mut released = false;
    for _ in 0..75 {
        if unsafe { CGEventSourceFlagsState(1) } & MODIFIERS == 0 {
            released = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    if !released {
        return Err("Modifier keys remained down; text was kept for Copy.".into());
    }
    let result = on_main(app, move |app| {
        NativeDestination::verify(&original)?;
        let state = app.state::<ProbeState>();
        // Verify the session is still current before changing the clipboard.
        if let Some(id) = &session_id {
            let data = state
                .data
                .lock()
                .map_err(|_| "Insertion state is unavailable.")?;
            let captured = data
                .dictation
                .as_ref()
                .filter(|item| &item.session_id == id)
                .ok_or("This dictation destination is no longer available. Use Copy.")?;
            if captured.paste_attempted {
                return Err(
                    "Paste was already attempted. Use Copy to avoid duplicate insertion.".into(),
                );
            }
        }
        put_text(&state, &text, false)?;
        let preflight = (|| {
            NativeDestination::verify(&original)?;
            if unsafe { CGEventSourceFlagsState(1) } & MODIFIERS != 0 {
                return Err("Modifier keys changed; text was kept for Copy.".into());
            }
            let mut data = state
                .data
                .lock()
                .map_err(|_| "Insertion state is unavailable.")?;
            if data
                .recovery
                .as_ref()
                .is_none_or(|saved| saved.sequence != sequence())
            {
                return Err("Clipboard changed; newer contents were preserved.".into());
            }
            if !clipboard_contains_text(&text)
                || data
                    .recovery
                    .as_ref()
                    .is_none_or(|saved| saved.sequence != sequence())
            {
                return Err("Clipboard changed; newer contents were preserved.".into());
            }
            if let Some(id) = &session_id {
                claim_paste(&mut data.dictation, id)?;
            }
            Ok(())
        })();
        if let Err(error) = preflight {
            let restored = restore_automatic(&state);
            return Ok(Err(InsertionResult {
                clipboard_restored: matches!(restored, Ok(true)),
                message: if restored.is_err() {
                    format!("{error} Clipboard restore is pending; use Restore previous clipboard.")
                } else {
                    error
                },
                ..InsertionResult::refused("")
            }));
        }
        Ok(Ok(NativeDestination::dispatch_paste()))
    })
    .await?;
    let paste_result = match result {
        Ok(result) => result,
        Err(refused) => return Ok(refused),
    };
    tokio::time::sleep(Duration::from_millis(250)).await;
    let restored = on_main(app, |app| restore_automatic(&app.state::<ProbeState>())).await;
    Ok(insertion_outcome(paste_result, restored))
}

#[tauri::command]
pub async fn capture_target(app: AppHandle) -> Result<String, String> {
    on_main(&app, |app| {
        let state = app.state::<ProbeState>();
        let _operation = state
            .operation
            .try_lock()
            .map_err(|_| "Clipboard operation is busy. Try again.")?;
        let mut data = state
            .data
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?;
        data.target = None;
        if data.recovery.is_some() {
            return Err("Restore the previous clipboard before another insertion attempt.".into());
        }
        data.target = Some(NativeDestination::capture()?);
        Ok("Target captured. Release the shortcut to insert the test text.".into())
    })
    .await
}
#[tauri::command]
pub async fn capture_dictation_target(app: AppHandle, session_id: String) -> Result<(), String> {
    on_main(&app, move |app| {
        let state = app.state::<ProbeState>();
        let _operation = state
            .operation
            .try_lock()
            .map_err(|_| "Clipboard operation is busy. Try again.")?;
        let mut data = state
            .data
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?;
        data.dictation = None;
        if data.recovery.is_some() {
            return Err("Restore the previous clipboard before another dictation.".into());
        }
        data.dictation = Some(DictationTarget {
            session_id,
            target: NativeDestination::capture()?,
            paste_attempted: false,
        });
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn discard_dictation_target(app: AppHandle, session_id: String) -> Result<(), String> {
    on_main(&app, move |app| {
        let state = app.state::<ProbeState>();
        let mut data = state
            .data
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?;
        if data
            .dictation
            .as_ref()
            .is_some_and(|item| item.session_id == session_id)
        {
            data.dictation = None;
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn insert_dictation_text(
    app: AppHandle,
    session_id: String,
    text: String,
) -> InsertionResult {
    let id = session_id.clone();
    let original = on_main(&app, move |app| {
        let state = app.state::<ProbeState>();
        let data = state
            .data
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?;
        let saved = data
            .dictation
            .as_ref()
            .filter(|item| item.session_id == id)
            .ok_or("This dictation destination is unavailable. Use Copy.")?;
        if saved.paste_attempted {
            return Ok(Err(InsertionResult {
                paste_attempted: true,
                message: "Paste was already attempted. Use Copy to avoid duplicate insertion."
                    .into(),
                ..InsertionResult::refused("")
            }));
        }
        Ok(Ok(saved.target.clone()))
    })
    .await;
    match original {
        Ok(Ok(original)) => insert_text(&app, original, text, Some(session_id))
            .await
            .unwrap_or_else(InsertionResult::refused),
        Ok(Err(result)) => result,
        Err(error) => InsertionResult::refused(error),
    }
}
#[tauri::command]
pub async fn insert_test_text(app: AppHandle) -> Result<String, String> {
    let original = on_main(&app, |app| {
        app.state::<ProbeState>()
            .data
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?
            .target
            .take()
            .ok_or("No captured target; text was kept for Copy.".into())
    })
    .await?;
    let result = insert_text(&app, original, TEST_TEXT.into(), None).await?;
    if result.paste_sent {
        Ok(result.message)
    } else {
        Err(result.message)
    }
}
#[tauri::command]
pub async fn copy_dictation_text(
    app: AppHandle,
    text: String,
    without_backup: bool,
) -> Result<String, String> {
    validate_text(&text)?;
    on_main(&app, move |app| {
        let state = app.state::<ProbeState>();
        let _operation = state
            .operation
            .try_lock()
            .map_err(|_| "Clipboard operation is busy. Try again.")?;
        put_text(&state, &text, without_backup)?;
        Ok(if without_backup {
            "Text copied without a backup; Restore is unavailable."
        } else {
            "Text copied; previous clipboard saved for Restore."
        }
        .into())
    })
    .await
}
#[tauri::command]
pub async fn copy_test_text(app: AppHandle) -> Result<String, String> {
    copy_dictation_text(app, TEST_TEXT.into(), false).await
}
#[tauri::command]
pub async fn copy_test_text_without_backup(app: AppHandle) -> Result<String, String> {
    copy_dictation_text(app, TEST_TEXT.into(), true).await
}
#[tauri::command]
pub async fn restore_previous_clipboard(app: AppHandle) -> Result<String, String> {
    on_main(&app, |app| {
        let state = app.state::<ProbeState>();
        let _operation = state
            .operation
            .try_lock()
            .map_err(|_| "Clipboard operation is busy. Try again.")?;
        let mut data = state
            .data
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?;
        let saved = data
            .recovery
            .as_ref()
            .ok_or("No clipboard backup is pending.")?;
        // Explicit Restore intentionally replaces the current clipboard, just as
        // Windows does. Refuse a change that occurs while preparing the restore.
        write_clipboard(&saved.previous, sequence())?;
        data.recovery = None;
        Ok("Previous clipboard restored.".into())
    })
    .await
}
#[tauri::command]
pub async fn has_clipboard_backup(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<ProbeState>();
    let result = state
        .data
        .lock()
        .map_err(|_| "Insertion state is unavailable.")?
        .recovery
        .is_some();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_promises_refuse_backup_but_concrete_formats_remain_supported() {
        for name in [
            "com.apple.pasteboard.promised-file-url",
            "com.apple.pasteboard.promised-file-content-type",
            "com.apple.NSFilePromiseItemMetaData",
            "NSFilesPromisePboardType",
            "public.file-promise",
        ] {
            assert!(unsupported_clipboard_type(name));
        }
        for name in [
            "public.file-url",
            "public.rtf",
            "public.png",
            "public.utf8-plain-text",
            "com.yapyap.custom",
        ] {
            assert!(!unsupported_clipboard_type(name));
        }
    }
    #[test]
    fn destination_guards_reject_each_change() {
        let range = Range {
            location: 3,
            length: 0,
        };
        let point = Point { x: 1.0, y: 2.0 };
        assert!(guard_matches(true, true, range, range, point, point).is_ok());
        for (app, input, selection, mouse) in [
            (false, true, range, point),
            (true, false, range, point),
            (
                true,
                true,
                Range {
                    location: 4,
                    ..range
                },
                point,
            ),
            (true, true, Range { length: 1, ..range }, point),
            (true, true, range, Point { x: 2.0, ..point }),
        ] {
            assert!(guard_matches(app, input, selection, range, mouse, point).is_err());
        }
    }
    #[test]
    fn unicode_payload_and_empty_clipboard_are_lossless() {
        let text = "你好 😀\nhttps://example.com?q=2\nsrc/main.ts user_id 12.50";
        assert!(validate_text(text).is_ok());
        assert_eq!(plain_text(text).0[0][0].1, text.as_bytes());
        assert!(ClipboardSnapshot::default().0.is_empty());
        for text in ["", "  ", "hello\0hidden"] {
            assert!(validate_text(text).is_err());
        }
        assert!(validate_text(&"a".repeat(1024 * 1024 + 1)).is_err());
    }
    #[test]
    fn session_claim_rejects_stale_cancelled_and_duplicate_pastes() {
        let token = CFString::new("disposable identity");
        let handle = || unsafe { OwnedCf::new(CFRetain(token.as_CFTypeRef())).unwrap() };
        let mut data = ProbeData {
            dictation: Some(DictationTarget {
                session_id: "current".into(),
                target: Target {
                    pid: 1,
                    window: handle(),
                    focus: handle(),
                    selection: Range::default(),
                    mouse: Point::default(),
                },
                paste_attempted: false,
            }),
            ..ProbeData::default()
        };
        assert!(claim_paste(&mut data.dictation, "stale").is_err());
        assert!(!data.dictation.as_ref().unwrap().paste_attempted);
        assert!(claim_paste(&mut data.dictation, "current").is_ok());
        assert!(claim_paste(&mut data.dictation, "current").is_err());
        data.dictation = None;
        assert!(claim_paste(&mut data.dictation, "current").is_err());
    }
    #[test]
    fn post_paste_failures_never_become_retryable_refusals() {
        for (paste, restore, sent, restored) in [
            (Ok(()), Ok(true), true, true),
            (Ok(()), Ok(false), true, false),
            (Ok(()), Err("restore failed".into()), true, false),
            (Err("post failed".into()), Ok(true), false, true),
        ] {
            let result = insertion_outcome(paste, restore);
            assert!(result.paste_attempted);
            assert_eq!(result.paste_sent, sent);
            assert_eq!(result.clipboard_restored, restored);
        }
        assert!(!InsertionResult::refused("changed").paste_attempted);
        assert!(claim_paste(&mut ProbeData::default().dictation, "stale").is_err());
    }
}
