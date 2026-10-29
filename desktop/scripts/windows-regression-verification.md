# Windows native regression after the macOS port

Drafted October 29, 2026 against `d5b4358`. Not yet run.

The macOS port changed shared and Windows code between `161f413` (last Windows
acceptance baseline) and `d5b4358`. Those changes passed Mac native tests and
Windows-condition frontend/rendered tests on a Mac, but no Windows build has run
them. This checklist closes "Windows native regression remains pending" in
[MACOS_PROBES.md](../../MACOS_PROBES.md). Cross-platform parity can be claimed
only after every row below has an observed Windows result.

Scope is regression, not release. Rows that overlap
[Task 17 installed-app acceptance](task17-verification.md) note the matching row;
record the result in both. Signing, fresh-account, sleep/resume and Windows 10/ARM64
checks stay in Task 17.

## What changed on Windows

| Commit | Change | Risk |
| --- | --- | --- |
| `c72e3de` | WinHTTP replaced by a shared `reqwest` blocking client (Windows TLS, system proxy, no redirects, bounded size/deadline) for connection check, transcription and cleanup. A new client is built per request. | No successful saved-key request has run on Windows. TLS, proxy and error mapping differ; WinHTTP's implicit socket reuse is gone, so upload/cleanup latency may change. |
| `5e68704`, `0ccb230` | Credential Manager code moved to `credentials/windows.rs`; new `unlock_api_key` command; target renamed to `com.jingxuan-zhang.yapyap/openai-api-key`. | Save/read/delete through the new module; earlier keys are intentionally not read. |
| `0ccb230` | App identifier `app.byokdictation.hotkeyprobe` → `com.jingxuan-zhang.yapyap`. | New WebView2 profile and preferences key, single-instance identity and install entry. |
| `741d921` | Overlay monitor selection and `SW_SHOWNOACTIVATE`/`SW_HIDE` moved to `overlay/windows.rs`. | Logic moved unchanged; untested after the move. |
| `55a278a` | Shortcut plugin registration made platform-conditional (Windows keeps the Tauri plugin); Esc cancel comes from `#platform`. | Registration order and Esc binding. |
| `effbdfb`, `6d9886c`, `6437efd` | Insertion moved to `platform/insertion_windows.rs`; target validation, paste latch, outcome messages and clipboard restore-if-owned moved to shared modules. | Same behavior expected; restore now rechecks the sequence number inside `restore()` as well. |
| `600043d` | Main window `backgroundThrottling: disabled`. Windows still records through WebView2 (`nativeMicrophoneCapture = false`). | Mac WebKit stopped capturing while hidden; confirm WebView2 still does, and that idle cost is acceptable. |
| `83a2f10`–`600043d` | New: recording-only mic test without a key, **Download recording** to Downloads, overlay IPC check refactored, upload gain added then removed (net none). | New UI paths never run on Windows. |

## Automated checks

Run on the Windows build host from `desktop/` with the candidate commit checked out.

| Check | Command | Result |
| --- | --- | --- |
| Release script | `npm.cmd run release:windows` (lockfile install, audit, `npm test`, Edge rendered UI, Rust fmt/tests, NSIS build, leak scan) | Pending |
| Group 3 shared + native | `npm.cmd run test:group3` (Windows and Mac module selections, `cargo test --lib`, rendered UI, privacy scanners) | Pending |
| Host primitives | `npm.cmd run test:group3 -- --quick --native-probes` (disposable Credential Manager restart probe; invalid-key OpenAI checks over the new client) | Pending |

## Manual checks

Use the installed build from the release script, launched from Start with no Vite
server. Quit and uninstall any earlier YapYap/BYOK Dictation build first. Use
disposable text and clipboards; restore your own clipboard afterwards.

| Area | Procedure and required observation | Task 17 row | Result |
| --- | --- | --- | --- |
| Identity | Install over a machine that had an earlier build. One YapYap entry in Installed apps and Start. Preferences start at defaults; the old credential is not read. A second launch focuses the existing window. Profile data is under `%LOCALAPPDATA%\com.jingxuan-zhang.yapyap`. | Reinstall/upgrade; Shortcut conflict/second launch | Pending |
| Key lifecycle | Save a key; Credential Manager shows the new target. Quit and relaunch: key present, field empty. Check connection succeeds. Replace with an invalid key: sanitized error, no key text shown. Delete: presence clears and the credential is gone. | Restart preferences | Pending |
| HTTPS success | With a valid key, dictate with full-audio on and cleanup on: transcript, separate original/output, paste. Repeat with cleanup off, then full-audio off (live-only). | Physical microphone and targets | Pending |
| HTTPS failures | Disconnect the network before release: recording and live words retained. Reconnect and retry without recording again. If a system proxy is normally configured, confirm requests succeed through it. | Network loss/retry | Pending |
| Latency | Record per-stage and total timings for three short dictations. Compare upload and cleanup stages with [canonical upload](canonical-upload-benchmark.md) and [cleanup](cleanup-fast-benchmark.md) figures; note any consistent regression. | — | Pending |
| Overlay | Type continuously in Notepad while the overlay appears: focus never moves. Pointer clicks pass through. With two monitors, it appears on the foreground app's monitor. It hides after success and cancel. | Physical microphone and targets | Pending |
| Shortcuts | Hold/release with Notepad focused; rebind and use the new binding; Esc cancels only during a session and does not leak to the target; a conflicting binding keeps the original. | Shortcut conflict/second launch; Cancellation | Pending |
| Insertion | Unicode/multiline sample pastes once into Notepad, VS Code and a browser field. Moving the caret, moving the pointer, switching apps, closing the target, or holding a modifier for three seconds refuses paste and retains the text. Retry saved output into a new target with no provider calls. | Changed destination | Pending |
| Clipboard | Rich text (copy from Word or a browser) is restored after paste. `scripts/newer-copy-smoke.ps1` keeps the newer copy. Copy/Replace/Restore previous clipboard work. A clipboard held open by another app reports busy and keeps the text. | Physical microphone and targets | Pending |
| Hidden capture | Close the main window to the tray, then dictate: capture level and live words match the open-window run. Repeat with the window minimized. Note idle CPU with the window hidden for five minutes. | Tray/quit | Pending |
| New UI paths | With no key saved, test the microphone: record, play back, clear; no request is made. **Download recording** saves a WAV to Downloads and shows its path; a second save does not overwrite the first. | — | Pending |
| Combined flow | Window in the tray: hold → speak → live overlay → full transcription → cleanup → paste into Notepad, three times in a row without discard. Earlier results stay viewable. | Repeat dictation | Pending |
| Privacy | After all checks, run `python desktop/scripts/audit-key-leaks.py --check-saved-key --check-app-data` from the repository root. No findings or unreadable files. | Release gate | Pending |

## Exit

Record observed results with date, Windows version and installer hash. A failure
is a gap: fix it, rerun the affected rows and the automated checks, and keep the
failure in this record. When every row passes, update the status in
[MACOS_PROBES.md](../../MACOS_PROBES.md) and the macOS checkpoint in
[TASKS.md](../../TASKS.md). Together, the shortcut, cancellation, combined-flow
and Task 17 permission/conflict rows can also close the open tray/hotkey check
under TASKS.md Task 12.
