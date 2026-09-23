# Windows text insertion probe

Run `npm install` and `npm run tauri dev` from this directory. The app registers `Ctrl+Alt+F8` by default; enter another Tauri accelerator and choose **Apply** to change it. It records no audio and uses the fixed string `BYOK dictation insertion probe`.

Put the caret in Notepad, VS Code, or a browser text field, then press and release the shortcut. On key-down the probe captures the foreground and focused window, caret rectangle when Windows provides one, and pointer position. After key-up it waits for modifier keys to be released, checks the target again, temporarily replaces the clipboard, sends Ctrl+V, and restores the saved formats if no newer copy occurred. Keep the pointer still during a normal insertion test. The probe refuses automatic paste when focus or the pointer/caret changes, a clipboard format cannot be backed up, or a Windows API call fails.

**Copy test text** saves supported clipboard formats, then puts the fixed string on the clipboard. **Restore previous clipboard** becomes available after that Copy action; use it after pasting the test string. This includes rich clipboard formats backed by movable global memory. GDI/owner-rendered formats and clipboard content over 64 MiB are not supported by this probe; the safe Copy action leaves them untouched and explains why. **Copy without backup** explicitly replaces an unsupported clipboard, and Restore remains unavailable. Automatic paste normally restores its own temporary clipboard without needing the Restore button; the button also becomes available if that restoration fails.

Test the following cases and record the observed result in `../DECISIONS.md`:

1. Plain-text clipboard, then insert into Notepad, VS Code, and a Chrome or Edge input. Confirm both the pasted string and clipboard restoration.
2. Switch apps before releasing, move the pointer or caret before releasing, and close the target before releasing. Confirm no automatic paste and use Copy.
3. Copy different text immediately after release. Confirm the probe does not overwrite that newer copy.

The probe reports that paste keystrokes were sent, not that the destination accepted them; confirm insertion in the target. It can detect the current target and caret position, but cannot prove that an app was switched away and back during one hold or that an input accepted the paste. Closing the probe window hides it; use the tray menu to show it or quit.

For a repeatable Windows text-box check while the probe is running, use `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/insertion-smoke.ps1`. It opens a temporary focused input, sends real Windows key events, and reports inserted text and whether clipboard text matches its value before the test. Notepad, VS Code, and browser checks remain separate manual checks.

To check that a newer clipboard copy is preserved, run `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/newer-copy-smoke.ps1` while the probe is open. The script replaces the clipboard with disposable text. Within 15 seconds, focus a blank Notepad document and press Ctrl+Alt+F8. The script watches for the probe's temporary clipboard text, copies a newer marker, and reports whether the marker survives the probe's restore attempt.
