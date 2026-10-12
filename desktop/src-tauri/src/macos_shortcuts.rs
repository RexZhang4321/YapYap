//! Exclusive Mac hotkeys, with the same IPC contract as the Windows plugin.
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::c_void,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, RunEvent, State, Wry,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

#[repr(C)]
struct HotkeyId {
    signature: u32,
    id: u32,
}
#[repr(C)]
struct EventType {
    class: u32,
    kind: u32,
}
const SIGNATURE: u32 = u32::from_be_bytes(*b"YAPS");
const NOT_HANDLED: i32 = -9874;

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn GetApplicationEventTarget() -> *mut c_void;
    fn InstallEventHandler(
        target: *mut c_void,
        handler: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> i32,
        count: u32,
        types: *const EventType,
        context: *mut c_void,
        result: *mut *mut c_void,
    ) -> i32;
    fn RemoveEventHandler(handler: *mut c_void) -> i32;
    fn RegisterEventHotKey(
        key: u32,
        modifiers: u32,
        id: HotkeyId,
        target: *mut c_void,
        options: u32,
        result: *mut *mut c_void,
    ) -> i32;
    fn UnregisterEventHotKey(reference: *mut c_void) -> i32;
    fn GetEventKind(event: *mut c_void) -> u32;
    fn GetEventParameter(
        event: *mut c_void,
        name: u32,
        kind: u32,
        actual_type: *mut u32,
        size: u32,
        actual_size: *mut u32,
        data: *mut c_void,
    ) -> i32;
}

#[derive(Clone, Serialize)]
struct ShortcutEvent {
    shortcut: String,
    id: u32,
    state: ShortcutState,
}
struct Binding {
    reference: usize,
    shortcut: Shortcut,
    handler: Channel<ShortcutEvent>,
}
#[derive(Default)]
struct Shortcuts {
    bindings: Mutex<HashMap<u32, Binding>>,
    handler: AtomicUsize,
}

fn scan_code(code: Code) -> Result<u32, String> {
    // Physical ANSI key positions, independent of the user's keyboard layout.
    let name = code.to_string();
    let letters = [
        0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15, 1, 17, 32, 9, 13, 7, 16,
        6,
    ];
    if let Some(letter) = name.strip_prefix("Key").filter(|s| s.len() == 1) {
        if letter.as_bytes()[0].is_ascii_uppercase() {
            return Ok(letters[(letter.as_bytes()[0] - b'A') as usize]);
        }
    }
    let digits = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25];
    if let Some(digit) = name.strip_prefix("Digit").filter(|s| s.len() == 1) {
        if digit.as_bytes()[0].is_ascii_digit() {
            return Ok(digits[(digit.as_bytes()[0] - b'0') as usize]);
        }
    }
    let functions = [
        122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
    ];
    if let Some(number) = name.strip_prefix('F').and_then(|s| s.parse::<usize>().ok()) {
        if (1..=functions.len()).contains(&number) {
            return Ok(functions[number - 1]);
        }
    }
    match code {
        Code::Escape => Ok(53),
        Code::Space => Ok(49),
        Code::Enter => Ok(36),
        Code::Tab => Ok(48),
        Code::Backspace => Ok(51),
        Code::Delete => Ok(117),
        Code::Insert => Ok(114),
        Code::Home => Ok(115),
        Code::End => Ok(119),
        Code::PageUp => Ok(116),
        Code::PageDown => Ok(121),
        Code::ArrowLeft => Ok(123),
        Code::ArrowRight => Ok(124),
        Code::ArrowDown => Ok(125),
        Code::ArrowUp => Ok(126),
        _ => Err("shortcut_unavailable".into()),
    }
}
fn modifiers(shortcut: &Shortcut) -> u32 {
    let mut value = 0;
    for (flag, mask) in [
        (Modifiers::SHIFT, 512),
        (Modifiers::SUPER | Modifiers::META, 256),
        (Modifiers::ALT, 2048),
        (Modifiers::CONTROL, 4096),
    ] {
        if shortcut.mods.intersects(flag) {
            value |= mask;
        }
    }
    value
}

unsafe extern "C" fn receive(_: *mut c_void, event: *mut c_void, context: *mut c_void) -> i32 {
    let mut id = HotkeyId {
        signature: 0,
        id: 0,
    };
    if GetEventParameter(
        event,
        u32::from_be_bytes(*b"----"),
        u32::from_be_bytes(*b"hkid"),
        std::ptr::null_mut(),
        std::mem::size_of::<HotkeyId>() as u32,
        std::ptr::null_mut(),
        (&mut id as *mut HotkeyId).cast(),
    ) != 0
        || id.signature != SIGNATURE
    {
        return NOT_HANDLED;
    }
    // The managed Arc outlives this installed handler; both are removed at Exit.
    let Some(store) = context.cast::<Shortcuts>().as_ref() else {
        return NOT_HANDLED;
    };
    let binding = store.bindings.lock().ok().and_then(|bindings| {
        bindings
            .get(&id.id)
            .map(|b| (b.shortcut, b.handler.clone()))
    });
    let Some((shortcut, handler)) = binding else {
        return NOT_HANDLED;
    };
    let state = match GetEventKind(event) {
        5 => ShortcutState::Pressed,
        6 => ShortcutState::Released,
        _ => return NOT_HANDLED,
    };
    let _ = handler.send(ShortcutEvent {
        shortcut: shortcut.into_string(),
        id: id.id,
        state,
    });
    0
}

async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(work());
    })
    .map_err(|_| "shortcut_unavailable")?;
    receive.await.map_err(|_| "shortcut_unavailable")?
}

#[tauri::command]
async fn register(
    app: AppHandle,
    store: State<'_, Arc<Shortcuts>>,
    shortcuts: Vec<String>,
    handler: Channel<ShortcutEvent>,
) -> Result<(), String> {
    let keys = shortcuts
        .into_iter()
        .map(|s| {
            let shortcut: Shortcut = s.parse().map_err(|_| "shortcut_unavailable")?;
            Ok((shortcut, scan_code(shortcut.key)?))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let store = store.inner().clone();
    on_main(&app, move || {
        let mut bindings = store.bindings.lock().map_err(|_| "shortcut_unavailable")?;
        let mut added = Vec::new();
        for (shortcut, code) in keys {
            let mut reference = std::ptr::null_mut();
            // kEventHotKeyExclusive = 1: reject existing exclusive registrations, and prevent
            // another app's shared binding from receiving our recording shortcut.
            let status = unsafe {
                RegisterEventHotKey(
                    code,
                    modifiers(&shortcut),
                    HotkeyId {
                        signature: SIGNATURE,
                        id: shortcut.id(),
                    },
                    GetApplicationEventTarget(),
                    1,
                    &mut reference,
                )
            };
            if status != 0 {
                for id in added {
                    if let Some(binding) = bindings.get(&id) {
                        if unsafe { UnregisterEventHotKey(binding.reference as *mut c_void) } == 0 {
                            bindings.remove(&id);
                        }
                    }
                }
                return Err("shortcut_unavailable".into());
            }
            added.push(shortcut.id());
            bindings.insert(
                shortcut.id(),
                Binding {
                    reference: reference as usize,
                    shortcut,
                    handler: handler.clone(),
                },
            );
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn unregister(
    app: AppHandle,
    store: State<'_, Arc<Shortcuts>>,
    shortcuts: Vec<String>,
) -> Result<(), String> {
    let keys = shortcuts
        .into_iter()
        .map(|s| {
            s.parse::<Shortcut>()
                .map_err(|_| "shortcut_unavailable".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let store = store.inner().clone();
    on_main(&app, move || {
        let mut bindings = store.bindings.lock().map_err(|_| "shortcut_unavailable")?;
        for key in keys {
            if let Some(binding) = bindings.get(&key.id()) {
                if unsafe { UnregisterEventHotKey(binding.reference as *mut c_void) } != 0 {
                    return Err("shortcut_unavailable".into());
                }
                bindings.remove(&key.id());
            }
        }
        Ok(())
    })
    .await
}

pub(crate) fn init() -> TauriPlugin<Wry> {
    Builder::new("global-shortcut")
        .invoke_handler(tauri::generate_handler![register, unregister])
        .setup(|app, _| {
            let store = Arc::new(Shortcuts::default());
            let types = [
                EventType {
                    class: u32::from_be_bytes(*b"keyb"),
                    kind: 5,
                },
                EventType {
                    class: u32::from_be_bytes(*b"keyb"),
                    kind: 6,
                },
            ];
            let mut handler = std::ptr::null_mut();
            let status = unsafe {
                InstallEventHandler(
                    GetApplicationEventTarget(),
                    receive,
                    types.len() as u32,
                    types.as_ptr(),
                    Arc::as_ptr(&store).cast_mut().cast(),
                    &mut handler,
                )
            };
            if status != 0 {
                return Err("Could not initialize Mac shortcuts".into());
            }
            store.handler.store(handler as usize, Ordering::Relaxed);
            app.manage(store);
            Ok(())
        })
        .on_event(|app, event| {
            if let RunEvent::Exit = event {
                let store = app.state::<Arc<Shortcuts>>();
                if let Ok(mut bindings) = store.bindings.lock() {
                    for (_, binding) in bindings.drain() {
                        unsafe {
                            UnregisterEventHotKey(binding.reference as *mut c_void);
                        }
                    }
                }
                let handler = store.handler.swap(0, Ordering::Relaxed);
                if handler != 0 {
                    unsafe {
                        RemoveEventHandler(handler as *mut c_void);
                    }
                }
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_keys_and_modifiers_match_the_recorded_shortcut() {
        for (text, code) in [
            ("Ctrl+Alt+1", 18),
            ("Ctrl+Alt+2", 19),
            ("Super+Shift+A", 0),
            ("Alt+F8", 100),
            ("Ctrl+Escape", 53),
            ("Alt+Delete", 117),
            ("Super+PageDown", 121),
        ] {
            let key: Shortcut = text.parse().unwrap();
            assert_eq!(scan_code(key.key).unwrap(), code);
        }
        let key: Shortcut = "Ctrl+Alt+1".parse().unwrap();
        assert_eq!(modifiers(&key), 6144);
        assert!(scan_code(Code::F21).is_err());
    }
}
