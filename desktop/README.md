# Windows global keybinding probe

Run `npm install` and `npm run tauri dev` from this directory. The app registers `Ctrl+Alt+F8` by default; enter another Tauri accelerator and choose **Apply** to change it. The event log timestamps key-down and key-up events. Hold state is DOWN only between those events. It records no audio.

Test the shortcut while Notepad and VS Code have focus. Closing the probe window hides it; use the tray menu to show the log or quit. Registration errors appear in the window. A successful registration still needs a real key press to confirm that the shortcut is available in the foreground application.
