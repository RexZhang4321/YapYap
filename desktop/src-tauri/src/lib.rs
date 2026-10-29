use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

mod audio_capture;
mod cleanup;
mod credentials;
#[cfg(target_os = "macos")]
mod macos_shortcuts;
mod recording_export;
use platform::insertion;
mod openai;
mod overlay;
mod platform;
mod streaming;
mod transcription;

fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

fn command_available(webview: &str, command: &str) -> bool {
    webview == "main" || (webview == "overlay" && command == "overlay_snapshot")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let commands: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        overlay::claim_overlay,
        overlay::overlay_snapshot,
        overlay::update_overlay,
        insertion::capture_target,
        insertion::capture_dictation_target,
        insertion::discard_dictation_target,
        insertion::insert_dictation_text,
        insertion::copy_dictation_text,
        insertion::insert_test_text,
        insertion::copy_test_text,
        insertion::copy_test_text_without_backup,
        insertion::has_clipboard_backup,
        insertion::restore_previous_clipboard,
        credentials::has_api_key,
        credentials::unlock_api_key,
        credentials::save_api_key,
        credentials::delete_api_key,
        credentials::validate_api_key,
        transcription::transcribe_recording,
        recording_export::download_recording,
        cleanup::cleanup_transcript,
        streaming::start_live_stream,
        streaming::append_live_audio,
        streaming::finish_live_stream,
        streaming::cancel_live_stream,
        audio_capture::start_native_capture,
        audio_capture::stop_native_capture
    ];
    let builder = tauri::Builder::default();
    // Register first so duplicate launches exit before creating windows,
    // registering shortcuts, or initializing another dictation session.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        let _ = show_main_window(app);
    }));

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(macos_shortcuts::init());
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .manage(insertion::ProbeState::default())
        .manage(streaming::LiveState::default())
        .manage(overlay::OverlayState::default())
        .invoke_handler(move |invoke| {
            // App commands have no generated plugin ACL. Restrict the second
            // WebView explicitly; it may read bounded overlay state only.
            if !command_available(invoke.message.webview().label(), invoke.message.command()) {
                invoke.resolver.reject("command_unavailable");
                return true;
            }
            commands(invoke)
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("overlay") {
                window.set_ignore_cursor_events(true)?;
            }
            let show = MenuItem::with_id(app, "show", "Open YapYap", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("YapYap")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_main_window(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() == "overlay" {
                    // Resolve the WebView window for the explicit native hide.
                    if let Some(overlay_window) = window.app_handle().get_webview_window("overlay")
                    {
                        let _ = overlay::hide(&overlay_window);
                    }
                } else {
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Clicking the Dock icon reopens the main window. The overlay can be
            // the only visible window, so `has_visible_windows` is not consulted.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                let _ = show_main_window(_app);
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn overlay_reads_only_its_snapshot() {
        for command in ["overlay_snapshot"] {
            assert!(super::command_available("overlay", command));
            assert!(!super::command_available("unknown", command));
        }
        assert!(!super::command_available("overlay", "platform_info"));
        for command in [
            "save_api_key",
            "has_api_key",
            "unlock_api_key",
            "capture_target",
            "copy_test_text",
            "insert_dictation_text",
            "update_overlay",
        ] {
            assert!(!super::command_available("overlay", command));
            assert!(super::command_available("main", command));
        }
    }
}
