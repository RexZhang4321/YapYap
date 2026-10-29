//! Windows text destination capture, clipboard recovery, and guarded insertion.
use crate::platform::clipboard_shared::{restore_if_owned, ClipboardAdapter};
use crate::platform::insertion_shared::{
    claim_paste, insertion_outcome, validate_text, DestinationAdapter, DictationTarget,
    InsertionResult,
};
use std::{mem::size_of, ptr, sync::Mutex, thread, time::Duration};
use tauri::State;

pub const TEST_TEXT: &str = "YapYap dictation insertion probe";

#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Point {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
#[derive(Default)]
struct GuiThreadInfo {
    size: u32,
    flags: u32,
    active: isize,
    focus: isize,
    capture: isize,
    menu_owner: isize,
    move_size: isize,
    caret: isize,
    caret_rect: Rect,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct KeybdInput {
    vk: u16,
    scan: u16,
    flags: u32,
    time: u32,
    extra: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
union InputData {
    keyboard: KeybdInput,
    storage: [u64; 4],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Input {
    kind: u32,
    data: InputData,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn GetForegroundWindow() -> isize;
    fn GetWindowThreadProcessId(hwnd: isize, process_id: *mut u32) -> u32;
    fn GetGUIThreadInfo(thread_id: u32, info: *mut GuiThreadInfo) -> i32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn GetAsyncKeyState(key: i32) -> i16;
    fn SendInput(count: u32, input: *const Input, size: i32) -> u32;
    fn OpenClipboard(owner: isize) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn EnumClipboardFormats(format: u32) -> u32;
    fn GetClipboardData(format: u32) -> isize;
    fn SetClipboardData(format: u32, data: isize) -> isize;
    fn GetClipboardSequenceNumber() -> u32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalAlloc(flags: u32, bytes: usize) -> isize;
    fn GlobalLock(handle: isize) -> *mut u8;
    fn GlobalUnlock(handle: isize) -> i32;
    fn GlobalFree(handle: isize) -> isize;
    fn GlobalSize(handle: isize) -> usize;
    fn GetLastError() -> u32;
    fn SetLastError(code: u32);
}

const CF_UNICODETEXT: u32 = 13;
const GMEM_MOVEABLE: u32 = 2;
const MAX_CLIPBOARD_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone)]
struct ClipboardSnapshot(Vec<(u32, Vec<u8>)>);

#[derive(Clone, Copy)]
struct Target {
    window: isize,
    focus: isize,
    caret: Option<Rect>,
    mouse: Point,
}

#[derive(Default)]
struct ProbeData {
    target: Option<Target>,
    dictation: Option<DictationTarget<Target>>,
    clipboard_recovery: Option<ClipboardSnapshot>,
}

pub struct ProbeState(Mutex<ProbeData>);
impl Default for ProbeState {
    fn default() -> Self {
        Self(Mutex::new(ProbeData::default()))
    }
}

struct NativeDestination;
impl DestinationAdapter for NativeDestination {
    type Target = Target;
    fn capture() -> Result<Target, String> {
        target()
    }
    fn verify(original: &Target) -> Result<(), String> {
        same_target(*original, target()?)
    }
    fn dispatch_paste() -> Result<(), String> {
        paste()
    }
}

fn target() -> Result<Target, String> {
    unsafe {
        let window = GetForegroundWindow();
        if window == 0 {
            return Err("No foreground window was found.".into());
        }
        let thread_id = GetWindowThreadProcessId(window, ptr::null_mut());
        let mut info = GuiThreadInfo {
            size: size_of::<GuiThreadInfo>() as u32,
            ..Default::default()
        };
        if GetGUIThreadInfo(thread_id, &mut info) == 0 || info.focus == 0 {
            return Err("The focused input could not be identified.".into());
        }
        let mut mouse = Point::default();
        if GetCursorPos(&mut mouse) == 0 {
            return Err("The pointer position could not be read.".into());
        }
        Ok(Target {
            window,
            focus: info.focus,
            caret: (info.caret != 0).then_some(info.caret_rect),
            mouse,
        })
    }
}

#[tauri::command]
pub fn capture_target(state: State<'_, ProbeState>) -> Result<String, String> {
    let mut data = state.0.lock().map_err(|_| "Probe state is unavailable.")?;
    if data.clipboard_recovery.is_some() {
        return Err("Restore the previous clipboard before another insertion attempt.".into());
    }
    data.target = None;
    drop(data);
    let found = NativeDestination::capture()?;
    state
        .0
        .lock()
        .map_err(|_| "Probe state is unavailable.")?
        .target = Some(found);
    Ok("Target captured. Release the shortcut to insert the test text.".into())
}

fn wait_for_modifiers() -> Result<(), String> {
    for _ in 0..75 {
        let held = [0x10, 0x11, 0x12, 0x5b, 0x5c]
            .iter()
            .any(|key| unsafe { GetAsyncKeyState(*key) } < 0);
        if !held {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(20));
    }
    Err("Modifier keys remained down; text was kept for Copy.".into())
}

struct OpenClipboardGuard;
impl OpenClipboardGuard {
    fn new(owner: isize) -> Result<Self, String> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(owner) } != 0 {
                return Ok(Self);
            }
            thread::sleep(Duration::from_millis(20));
        }
        Err("Clipboard is busy; text was kept for Copy.".into())
    }
}
impl Drop for OpenClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}

fn read_clipboard_snapshot() -> Result<ClipboardSnapshot, String> {
    unsafe {
        let mut format = 0;
        let mut formats = Vec::new();
        let mut total_bytes = 0usize;
        loop {
            SetLastError(0);
            format = EnumClipboardFormats(format);
            if format == 0 {
                if GetLastError() != 0 {
                    return Err("Clipboard formats could not be enumerated.".into());
                }
                break;
            }
            if formats.len() >= 128 {
                return Err("Clipboard has too many formats to back up.".into());
            }
            // These formats use GDI handles or owner rendering, not movable global memory.
            if matches!(format, 2 | 3 | 9 | 14 | 0x80) {
                return Err(format!(
                    "Clipboard format {format} uses an unsupported handle."
                ));
            }
            let handle = GetClipboardData(format);
            if handle == 0 {
                return Err(format!("Clipboard format {format} could not be read."));
            }
            let bytes = GlobalSize(handle);
            total_bytes = total_bytes.saturating_add(bytes);
            if bytes == 0 || total_bytes > MAX_CLIPBOARD_BYTES {
                return Err(format!(
                    "Clipboard format {format} is unsupported or too large to back up."
                ));
            }
            let pointer = GlobalLock(handle);
            if pointer.is_null() {
                return Err(format!("Clipboard format {format} could not be backed up."));
            }
            let content = std::slice::from_raw_parts(pointer, bytes).to_vec();
            GlobalUnlock(handle);
            formats.push((format, content));
        }
        Ok(ClipboardSnapshot(formats))
    }
}

struct NativeClipboard;
impl ClipboardAdapter for NativeClipboard {
    type Snapshot = ClipboardSnapshot;
    type Revision = u32;
    fn snapshot() -> Result<Self::Snapshot, String> {
        read_clipboard_snapshot()
    }
    fn revision() -> Self::Revision {
        unsafe { GetClipboardSequenceNumber() }
    }
    fn contains_text(expected: &str) -> bool {
        clipboard_contains_text(expected)
    }
    fn restore(snapshot: &Self::Snapshot, revision: Self::Revision) -> Result<(), String> {
        if Self::revision() != revision {
            return Err("Clipboard changed; newer contents were preserved.".into());
        }
        set_clipboard_snapshot(snapshot)
    }
}

fn clipboard_contains_text(expected: &str) -> bool {
    unsafe {
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle == 0 {
            return false;
        }
        let bytes = GlobalSize(handle);
        let pointer = GlobalLock(handle) as *const u16;
        if pointer.is_null() || bytes < 2 {
            if !pointer.is_null() {
                GlobalUnlock(handle);
            }
            return false;
        }
        let units = std::slice::from_raw_parts(pointer, bytes / 2);
        let end = units
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(units.len());
        let text = String::from_utf16(&units[..end]).ok();
        GlobalUnlock(handle);
        text.as_deref() == Some(expected)
    }
}

fn set_clipboard_snapshot(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    unsafe {
        let mut handles = Vec::with_capacity(snapshot.0.len());
        for (format, content) in &snapshot.0 {
            let handle = GlobalAlloc(GMEM_MOVEABLE, content.len());
            if handle == 0 {
                for (_, unused) in handles {
                    GlobalFree(unused);
                }
                return Err("Clipboard restore allocation failed.".into());
            }
            let pointer = GlobalLock(handle);
            if pointer.is_null() {
                GlobalFree(handle);
                for (_, unused) in handles {
                    GlobalFree(unused);
                }
                return Err("Clipboard restore allocation failed.".into());
            }
            ptr::copy_nonoverlapping(content.as_ptr(), pointer, content.len());
            GlobalUnlock(handle);
            handles.push((*format, handle));
        }
        if EmptyClipboard() == 0 {
            for (_, unused) in handles {
                GlobalFree(unused);
            }
            return Err("Clipboard could not be cleared for restore.".into());
        }
        for index in 0..handles.len() {
            let (format, handle) = handles[index];
            if SetClipboardData(format, handle) == 0 {
                for (_, unused) in handles.into_iter().filter(|(_, handle)| *handle != 0) {
                    GlobalFree(unused);
                }
                return Err("A clipboard format could not be restored.".into());
            }
            handles[index].1 = 0; // Windows owns a successfully transferred handle.
        }
        Ok(())
    }
}

fn set_plain_clipboard(text: Option<&str>) -> Result<(), String> {
    unsafe {
        let handle = if let Some(text) = text {
            let mut utf16: Vec<u16> = text.encode_utf16().collect();
            utf16.push(0);
            let bytes = utf16.len() * 2;
            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if handle == 0 {
                return Err("Clipboard allocation failed.".into());
            }
            let pointer = GlobalLock(handle);
            if pointer.is_null() {
                GlobalFree(handle);
                return Err("Clipboard allocation failed.".into());
            }
            ptr::copy_nonoverlapping(utf16.as_ptr() as *const u8, pointer, bytes);
            GlobalUnlock(handle);
            handle
        } else {
            0
        };
        if EmptyClipboard() == 0 {
            if handle != 0 {
                GlobalFree(handle);
            }
            return Err("Clipboard could not be cleared.".into());
        }
        if handle == 0 {
            return Ok(());
        }
        if SetClipboardData(CF_UNICODETEXT, handle) == 0 {
            GlobalFree(handle);
            return Err("Clipboard text could not be set.".into());
        }
        Ok(())
    }
}

fn key(vk: u16, up: bool) -> Input {
    Input {
        kind: 1,
        data: InputData {
            keyboard: KeybdInput {
                vk,
                flags: if up { 2 } else { 0 },
                ..Default::default()
            },
        },
    }
}

fn paste() -> Result<(), String> {
    let input = [
        key(0x11, false),
        key(0x56, false),
        key(0x56, true),
        key(0x11, true),
    ];
    if unsafe {
        SendInput(
            input.len() as u32,
            input.as_ptr(),
            size_of::<Input>() as i32,
        )
    } != input.len() as u32
    {
        // A partial submission may have left Ctrl or V held down.
        let release = [key(0x56, true), key(0x11, true)];
        unsafe {
            SendInput(
                release.len() as u32,
                release.as_ptr(),
                size_of::<Input>() as i32,
            );
        }
        return Err("Windows did not accept the paste keystrokes.".into());
    }
    Ok(())
}

fn same_target(original: Target, current: Target) -> Result<(), String> {
    if current.window != original.window || current.focus != original.focus {
        return Err("Focused application or input changed; text was kept for Copy.".into());
    }
    if current.mouse != original.mouse {
        return Err("Pointer moved; text was kept for Copy.".into());
    }
    if current.caret != original.caret {
        return Err("Text cursor moved; text was kept for Copy.".into());
    }
    Ok(())
}

fn restore_after_paste(
    owner: isize,
    state: &ProbeState,
    previous: &ClipboardSnapshot,
    our_sequence: u32,
    text: &str,
) -> Result<bool, String> {
    let mut restored = false;
    if unsafe { GetClipboardSequenceNumber() } == our_sequence {
        let _clipboard = OpenClipboardGuard::new(owner)?;
        restored = restore_if_owned::<NativeClipboard>(previous, our_sequence, text)?;
    }
    state
        .0
        .lock()
        .map_err(|_| "Insertion state is unavailable.")?
        .clipboard_recovery = None;
    Ok(restored)
}

fn insert_text(
    owner: isize,
    state: &ProbeState,
    original: Target,
    text: &str,
    session_id: Option<&str>,
) -> Result<InsertionResult, String> {
    validate_text(text)?;
    wait_for_modifiers()?;
    NativeDestination::verify(&original)?;
    let clipboard = OpenClipboardGuard::new(owner)?;
    let previous = NativeClipboard::snapshot()?;
    {
        let mut data = state
            .0
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?;
        if data.clipboard_recovery.is_some() {
            return Err("Restore the previous clipboard before inserting again.".into());
        }
        data.clipboard_recovery = Some(previous.clone());
    }
    if let Err(error) = set_plain_clipboard(Some(text)) {
        if set_clipboard_snapshot(&previous).is_ok() {
            state
                .0
                .lock()
                .map_err(|_| "Insertion state is unavailable.")?
                .clipboard_recovery = None;
        }
        return Err(error);
    }
    drop(clipboard);
    let our_sequence = unsafe { GetClipboardSequenceNumber() };
    // Recheck after acquiring/backing up the clipboard, immediately before paste.
    let preflight = (|| {
        NativeDestination::verify(&original)?;
        if let Some(id) = session_id {
            let mut data = state
                .0
                .lock()
                .map_err(|_| "Insertion state is unavailable.")?;
            claim_paste(&mut data.dictation, id)?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = preflight {
        let restored = restore_after_paste(owner, state, &previous, our_sequence, text);
        return Ok(InsertionResult {
            clipboard_restored: matches!(restored, Ok(true)),
            message: if restored.is_err() {
                format!("{error} Clipboard restore is pending; use Restore previous clipboard.")
            } else {
                error
            },
            ..InsertionResult::refused("")
        });
    }
    let paste_result = NativeDestination::dispatch_paste();
    thread::sleep(Duration::from_millis(250));
    let restore_result = restore_after_paste(owner, state, &previous, our_sequence, text);
    Ok(insertion_outcome(paste_result, restore_result))
}

#[tauri::command]
pub fn capture_dictation_target(
    session_id: String,
    state: State<'_, ProbeState>,
) -> Result<(), String> {
    let mut data = state
        .0
        .lock()
        .map_err(|_| "Insertion state is unavailable.")?;
    data.dictation = None;
    if data.clipboard_recovery.is_some() {
        return Err("Restore the previous clipboard before another dictation.".into());
    }
    data.dictation = Some(DictationTarget {
        session_id,
        target: NativeDestination::capture()?,
        paste_attempted: false,
    });
    Ok(())
}

#[tauri::command]
pub fn discard_dictation_target(
    session_id: String,
    state: State<'_, ProbeState>,
) -> Result<(), String> {
    let mut data = state
        .0
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
}

#[tauri::command]
pub fn insert_dictation_text(
    session_id: String,
    text: String,
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> InsertionResult {
    let attempt = (|| {
        let owner = window
            .hwnd()
            .map_err(|_| "The app window is unavailable.")?
            .0 as isize;
        let data = state
            .0
            .lock()
            .map_err(|_| "Insertion state is unavailable.")?;
        let captured = data
            .dictation
            .as_ref()
            .filter(|item| item.session_id == session_id)
            .ok_or("This dictation destination is unavailable. Use Copy.")?;
        if captured.paste_attempted {
            return Ok(InsertionResult {
                paste_attempted: true,
                paste_sent: false,
                clipboard_restored: false,
                message: "Paste was already attempted. Use Copy to avoid duplicate insertion."
                    .into(),
            });
        }
        let original = captured.target;
        drop(data);
        insert_text(owner, &state, original, &text, Some(&session_id))
    })();
    attempt.unwrap_or_else(InsertionResult::refused)
}

#[tauri::command]
pub fn insert_test_text(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let original = state
        .0
        .lock()
        .map_err(|_| "Probe state is unavailable.")?
        .target
        .take()
        .ok_or("No captured target; text was kept for Copy.")?;
    let result = insert_text(owner, &state, original, TEST_TEXT, None)?;
    if result.paste_sent {
        Ok(result.message)
    } else {
        Err(result.message)
    }
}

#[tauri::command]
pub fn copy_dictation_text(
    text: String,
    without_backup: bool,
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    validate_text(&text)?;
    let owner = window
        .hwnd()
        .map_err(|_| "The app window is unavailable.")?
        .0 as isize;
    let mut data = state
        .0
        .lock()
        .map_err(|_| "Insertion state is unavailable.")?;
    if data.clipboard_recovery.is_some() {
        return Err("Restore the previous clipboard before copying again.".into());
    }
    let _clipboard = OpenClipboardGuard::new(owner)?;
    if without_backup {
        set_plain_clipboard(Some(&text))?;
        return Ok("Transcript copied without a backup; Restore is unavailable.".into());
    }
    let previous = NativeClipboard::snapshot().map_err(|_| "The clipboard cannot be backed up. Use Copy transcript without backup to replace it explicitly.")?;
    data.clipboard_recovery = Some(previous.clone());
    if let Err(error) = set_plain_clipboard(Some(&text)) {
        if set_clipboard_snapshot(&previous).is_ok() {
            data.clipboard_recovery = None;
        }
        return Err(error);
    }
    Ok("Transcript copied; previous clipboard saved for Restore.".into())
}

#[tauri::command]
pub fn restore_previous_clipboard(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let previous = state
        .0
        .lock()
        .map_err(|_| "Probe state is unavailable.")?
        .clipboard_recovery
        .clone()
        .ok_or("No clipboard backup is pending.")?;
    let _clipboard = OpenClipboardGuard::new(owner)?;
    set_clipboard_snapshot(&previous)?;
    state
        .0
        .lock()
        .map_err(|_| "Probe state is unavailable.")?
        .clipboard_recovery = None;
    Ok("Previous clipboard restored.".into())
}

#[tauri::command]
pub fn copy_test_text(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let mut data = state.0.lock().map_err(|_| "Probe state is unavailable.")?;
    if data.clipboard_recovery.is_some() {
        return Err("Restore the previous clipboard before copying again.".into());
    }
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let _clipboard = OpenClipboardGuard::new(owner)?;
    let previous = NativeClipboard::snapshot()
        .map_err(|reason| format!("{reason} Use Copy without backup to replace it explicitly."))?;
    data.clipboard_recovery = Some(previous.clone());
    if let Err(error) = set_plain_clipboard(Some(TEST_TEXT)) {
        if set_clipboard_snapshot(&previous).is_ok() {
            data.clipboard_recovery = None;
        }
        return Err(error);
    }
    Ok("Test text copied; previous clipboard saved. Restore it when finished pasting.".into())
}

#[tauri::command]
pub fn copy_test_text_without_backup(
    window: tauri::WebviewWindow,
    state: State<'_, ProbeState>,
) -> Result<String, String> {
    let data = state.0.lock().map_err(|_| "Probe state is unavailable.")?;
    if data.clipboard_recovery.is_some() {
        return Err("Restore the previous clipboard before copying again.".into());
    }
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let _clipboard = OpenClipboardGuard::new(owner)?;
    set_plain_clipboard(Some(TEST_TEXT))?;
    drop(data);
    Ok("Test text copied without a backup; Restore is unavailable.".into())
}

#[tauri::command]
pub fn has_clipboard_backup(state: State<'_, ProbeState>) -> Result<bool, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "Probe state is unavailable.")?
        .clipboard_recovery
        .is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_target() -> Target {
        Target {
            window: 1,
            focus: 2,
            mouse: Point { x: 5, y: 6 },
            caret: Some(Rect {
                left: 10,
                top: 20,
                right: 11,
                bottom: 30,
            }),
        }
    }

    #[test]
    fn changed_destinations_refuse_insertion() {
        let original = fixture_target();
        assert!(same_target(original, original).is_ok());
        for changed in [
            Target {
                window: 3,
                ..original
            },
            Target {
                focus: 4,
                ..original
            },
            Target {
                mouse: Point { x: 7, y: 6 },
                ..original
            },
            Target {
                caret: None,
                ..original
            },
            Target {
                caret: Some(Rect {
                    left: 12,
                    ..original.caret.unwrap()
                }),
                ..original
            },
        ] {
            assert!(same_target(original, changed).is_err());
        }
    }

    #[test]
    fn session_token_and_paste_latch_prevent_duplicate_or_stale_insertion() {
        let mut data = ProbeData {
            dictation: Some(DictationTarget {
                session_id: "current".into(),
                target: fixture_target(),
                paste_attempted: false,
            }),
            ..Default::default()
        };
        assert!(claim_paste(&mut data.dictation, "old").is_err());
        assert!(!data.dictation.as_ref().unwrap().paste_attempted);
        assert!(claim_paste(&mut data.dictation, "current").is_ok());
        assert!(claim_paste(&mut data.dictation, "current").is_err());
        data.dictation = None;
        assert!(claim_paste(&mut data.dictation, "current").is_err());
    }

    #[test]
    fn insertion_payload_preserves_unicode_and_rejects_clipboard_truncation() {
        assert!(validate_text(
            "你好 😀\nhttps://example.com?q=2\nsrc/main.ts AS5047P user_id 12.50"
        )
        .is_ok());
        for text in ["", "  ", "hello\0hidden"] {
            assert!(validate_text(text).is_err());
        }
        assert!(validate_text(&"a".repeat(1024 * 1024 + 1)).is_err());
    }

    #[test]
    fn restoration_failure_keeps_successful_paste_distinct_from_refusal() {
        let sent = insertion_outcome(Ok(()), Err("Clipboard busy".into()));
        let serialized = serde_json::to_value(sent).unwrap();
        assert_eq!(serialized["pasteAttempted"], true);
        assert_eq!(serialized["pasteSent"], true);
        assert_eq!(serialized["clipboardRestored"], false);
        let partial = insertion_outcome(Err("Partial SendInput".into()), Ok(true));
        assert!(partial.paste_attempted);
        assert!(!partial.paste_sent);
        assert!(partial.clipboard_restored);
        assert!(!InsertionResult::refused("Target changed").paste_attempted);
    }
}
