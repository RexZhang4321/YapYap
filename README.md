# YapYap

Talk it out. YapYap is a Windows hold-to-talk dictation app that uses your own
OpenAI API key. Hold your shortcut, speak, then release to insert your words.
Live words appear in a floating overlay, and optional cleanup tidies the text.

## Install on Windows

Run `YapYap_0.1.0_x64-setup.exe`, then launch **YapYap** from the Start menu.
The per-user installation places `yapyap.exe` in `%LOCALAPPDATA%\YapYap`.
Open Settings to save your API key, allow microphone access, and choose a
shortcut. The default shortcut is `Ctrl+Alt+F8`. Close the window to keep YapYap
in the tray; choose **Quit** from the tray to exit.

Local test installers are unsigned. Build one with `npm.cmd run release:windows`
from `desktop/`; the output is in `desktop/src-tauri/target/release/bundle/nsis/`.
See the [Windows release guide](desktop/RELEASE.md) for prerequisites, checks,
signing, and release acceptance.

If you installed the earlier **BYOK Dictation** build, quit it and uninstall
that version before installing YapYap. Leave **Delete application data**
unchecked to retain preferences. The app ID, preference storage key, and
Credential Manager target stay compatible with the earlier build; the saved
API key remains in Windows Credential Manager.

## Develop

```powershell
cd desktop
npm install
npm run tauri -- dev
```

The npm and Rust packages are named `yapyap`; the native library is
`yapyap_lib`. Source remains in `desktop/`. See the
[desktop guide](desktop/README.md) for behavior, development, and verification.
