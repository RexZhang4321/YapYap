use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

mod cleanup;
mod credentials;
mod insertion;
mod openai;
mod overlay;
mod streaming;
mod transcription;

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
        credentials::save_api_key,
        credentials::delete_api_key,
        credentials::validate_api_key,
        transcription::transcribe_recording,
        cleanup::cleanup_transcript,
        streaming::start_live_stream,
        streaming::append_live_audio,
        streaming::finish_live_stream,
        streaming::cancel_live_stream
    ];
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(insertion::ProbeState::default())
        .manage(streaming::LiveState::default())
        .manage(overlay::OverlayState::default())
        .invoke_handler(move |invoke| {
            // App commands have no generated plugin ACL. Restrict the second
            // WebView explicitly; it may read bounded overlay state only.
            if invoke.message.webview().label() != "main"
                && invoke.message.command() != "overlay_snapshot"
            {
                invoke.resolver.reject("command_unavailable");
                return true;
            }
            commands(invoke)
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("overlay") {
                window.set_ignore_cursor_events(true)?;
            }
            let show = MenuItem::with_id(app, "show", "Show probe", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
