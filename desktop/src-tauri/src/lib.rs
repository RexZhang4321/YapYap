use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

mod credentials;
mod insertion;
mod openai;
mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(insertion::ProbeState::default())
        .invoke_handler(tauri::generate_handler![
            insertion::capture_target,
            insertion::insert_test_text,
            insertion::copy_test_text,
            insertion::copy_test_text_without_backup,
            insertion::has_clipboard_backup,
            insertion::restore_previous_clipboard,
            credentials::has_api_key,
            credentials::save_api_key,
            credentials::delete_api_key,
            credentials::validate_api_key,
            transcription::transcribe_recording
        ])
        .setup(|app| {
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
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
