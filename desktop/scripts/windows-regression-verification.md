# Windows native regression after the macOS port

Drafted October 29, 2026 against `d5b4358`. Updated November 9, 2026 for
`d830c0e`. Automated checks run November 9, 2026; manual checks not yet run.

The macOS port changed shared and Windows code between `161f413` (last Windows
acceptance baseline) and `d830c0e`. Those changes passed Mac native tests and
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
| `38686f5` | Probe scaffolding removed: `ProbeState` renamed `InsertionState` (error text now "Insertion state is unavailable."); the two Shortcut test mode change handlers merged, with new hint copy; overlay fixture buttons and `showOverlayFixture` removed; unsupported-build and response-size messages reworded; the ignored `windows_overlay_observation` Rust test and Task 6–10 WebView2 helpers deleted. | Merged handler and Settings layout never run on Windows. No automated check reads the overlay window styles any more. |

`328fcab`, `9d22691`, `8c6793b` and `d830c0e` change only macOS code or docs.
Shared insertion, clipboard, overlay, credential and transport modules are
unchanged between `d5b4358` and `d830c0e`.

## Automated checks

Run on the Windows build host from `desktop/` with the candidate commit checked out.

| Check | Command | Result |
| --- | --- | --- |
| Release script | `npm.cmd run release:windows` (lockfile install, audit, `npm test`, Chrome rendered UI, Rust fmt/tests, NSIS build, leak scan) | **Pass, Nov 9** (second run). First run stopped at `npm audit --audit-level=high`: locked `vite` 8.3.0–8.3.2 had high advisories (GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22, GHSA-vfpm-58rq-9qcg; `launch-editor` GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm). `npm audit fix` moved the lockfile to `vite` 8.3.7 (6 packages, `package.json` unchanged). Second run: 0 vulnerabilities, `npm test` 178/178, rendered UI 47/47, `cargo fmt` clean, `cargo test --lib` 35 pass / 6 ignored, scanner tests OK, key audit clean (466 files, 978 Git objects). Unsigned `YapYap_0.1.0_x64-setup.exe`, 1,872,794 bytes, SHA-256 `782FAA7D3A99B30E796D941417484BD94E9587AD7FEDEF2E0FF8BEFC30169C1F`; manifest `workingTreeDirty: true` (this checklist and the lockfile bump uncommitted). |
| Group 3 shared + native | `npm.cmd run test:group3` (Windows and Mac module selections, `cargo test --lib`, Chrome rendered UI, privacy scanners) | **Pass, Nov 9**, after two environment issues. First run: `--offline` cargo could not find `hyper-tls 0.6.0` (never fetched on this host since `c72e3de`); `cargo fetch --locked` fixed it. Second run: Windows 165/165, Mac 165/165, `cargo test --lib` 35 pass / 6 ignored, rendered UI 46/47. The failure was "Windows build keeps credential setup and shows no platform notice": Chrome exited 1 ms after launch, before any assertion. It passed on a single rerun, so it was a cold-start flake. Scanner tests 4/4 OK; key audit found nothing in 391 files and 978 Git objects. |
| Host primitives | `npm.cmd run test:group3 -- --quick --native-probes` (disposable Credential Manager restart probe; invalid-key OpenAI checks over the new client) | **Pass, Nov 9.** `windows_credential_restart_probe`, `openai_rejects_invalid_fixture_key` and `openai_rejects_invalid_transcription_key` pass. Both OpenAI probes got 401 responses over `reqwest`. `cmdkey /list` shows no leftover YapYap credentials. |
| Native smoke | `npm.cmd run test:windows-native -- -Live -StopRunningApp` ([windows-native-smoke.ps1](windows-native-smoke.ps1) + [.cs](windows-native-smoke.cs)): the installed app with a synthetic WebView2 microphone and local CDP port; real shortcut via `keybd_event` into the harness's own target window; two OpenAI dictations with the saved key. Results in `<repo>/tmp/windows-native-smoke/results.json`. | **Pass, Nov 9** (third run, all 42 boolean checks). First two runs failed only on harness bugs: the Settings wording check matched the intentional `#test-text` insertion string, and Windows PowerShell read the UTF-8 source as ANSI, so the overlay title lookup never matched (0 samples). Final run: overlay sampled visible 396 times with no focus taken, same monitor as the foreground window, `WS_EX_NOACTIVATE`/`TOPMOST`/`TRANSPARENT` set; tray dictation pasted the cleaned output exactly once and restored an RTF clipboard; refusal after switching to a decoy window kept the text, and a shortcut tap pasted the saved output in 0.64 s; Esc during finishing discarded with no Esc delivered to the target; mic-only capture saved two distinct WAVs (deleted afterwards). |

Host: Windows 11 Education 10.0.26200 x64; Node 22.14.0, npm 10.9.2, cargo 1.96.0,
Python 3.11.9. Source `d830c0e` with this checklist and `package-lock.json` modified
(native smoke harness added afterwards; it changes no app code).

Installed November 9, 2026: the earlier YapYap 0.1.0 (October 6, pre-port) was
removed with its uninstaller in silent mode, keeping application data. The
installer above was then installed silently and launched from the Start shortcut.
One YapYap entry exists in the uninstall registry. The app runs from
`%LOCALAPPDATA%\YapYap\yapyap.exe` with its profile under
`%LOCALAPPDATA%\com.jingxuan-zhang.yapyap`. The old `app.byokdictation.hotkeyprobe`
and `com.jingxuan.byokdictation` data folders and the old
`app.byokdictation.hotkeyprobe/openai-api-key` credential remain, so the Identity
row can confirm they are ignored.

## Manual checks

Use the installed build from the release script, launched from Start with no Vite
server. Quit and uninstall any earlier YapYap/BYOK Dictation build first. Use
disposable text and clipboards; restore your own clipboard afterwards.

| Area | Procedure and required observation | Task 17 row | Result |
| --- | --- | --- | --- |
| Identity | Install over a machine that had an earlier build. One YapYap entry in Installed apps and Start. Preferences start at defaults; the old credential is not read. A second launch focuses the existing window. Profile data is under `%LOCALAPPDATA%\com.jingxuan-zhang.yapyap`. | Reinstall/upgrade; Shortcut conflict/second launch | **Pass, Nov 9.** One Installed apps entry, no BYOK Dictation entry. A second Start launch stayed one process (PID 10612) and brought the existing window forward. Settings showed no saved key with the old `app.byokdictation.hotkeyprobe/openai-api-key` credential still present, and preferences at defaults. Profile under `%LOCALAPPDATA%\com.jingxuan-zhang.yapyap`. |
| Key lifecycle | Save a key; Credential Manager shows the new target. Quit and relaunch: key present, field empty. Check connection succeeds. Replace with an invalid key: sanitized error, no key text shown. Delete: presence clears and the credential is gone. | Restart preferences | **Pass, Nov 9.** Save, tray Quit and relaunch (key present, field empty), connection check, invalid-key sanitized error, and delete (indicator cleared) all pass as observed in the UI. After delete, `CredEnumerateW("com.jingxuan-zhang.yapyap*")` returns not found; only the old `app.byokdictation.hotkeyprobe/openai-api-key` (written October 1) remains. After re-saving, `com.jingxuan-zhang.yapyap/openai-api-key` exists (generic, local-machine persistence, written 10:27 PM, non-empty secret; secret not read). `cmdkey /list` does not show this target while it does show the old one; use `CredEnumerateW` or the Credential Manager UI to check it. |
| HTTPS success | With a valid key, dictate with full-audio on and cleanup on: transcript, separate original/output, paste. Repeat with cleanup off, then full-audio off (live-only). | Physical microphone and targets | **Pass (native smoke), Nov 9**, full audio + cleanup over `reqwest`: original and cleaned shown, cleaned output pasted once. Cleanup-off and live-only were not rerun natively; rendered UI "main app controls skip selected requests" covers all 8 phase combinations. |
| HTTPS failures | Disconnect the network before release: recording and live words retained. Reconnect and retry without recording again. If a system proxy is normally configured, confirm requests succeed through it. | Network loss/retry | Pending. Not automated: a real network drop through `reqwest` and the proxy path. Recovery logic is covered by the recovery-audit tests. |
| Latency | Record per-stage and total timings for three short dictations. Compare upload and cleanup stages with [canonical upload](canonical-upload-benchmark.md) and [cleanup](cleanup-fast-benchmark.md) figures; note any consistent regression. | — | Timings recorded, comparison pending. Three native smoke runs (synthetic ~5 s phrase): transcription request 1.33 / 1.53 / 0.83 s, cleanup request 1.01 / 1.22 / 0.68 s, total after release 2.61 / 3.03 / 1.80 s. |
| Overlay | Type continuously in Notepad while the overlay appears: focus never moves. Pointer clicks pass through. With two monitors, it appears on the foreground app's monitor. It hides after success and cancel. While it is visible, a window inspector (for example Spy++) shows `WS_EX_NOACTIVATE`, `WS_EX_TOPMOST` and `WS_EX_TRANSPARENT` on the overlay window; the native smoke harness now samples these styles. | Physical microphone and targets | **Pass (native smoke), Nov 9.** Focus never moved to the app across 396 visible samples; click-through style set; same monitor as the foreground window; hidden after success and after Esc. A target on a second monitor was not exercised. |
| Shortcuts | Hold/release with Notepad focused; rebind and use the new binding; Esc cancels only during a session and does not leak to the target; a conflicting binding keeps the original. | Shortcut conflict/second launch; Cancellation | **Partial, Nov 9.** Hold/release and Esc (cancels during finishing, not delivered to the target) pass in native smoke. Rebind and conflicting binding pending. |
| Insertion | Unicode/multiline sample pastes once into Notepad, VS Code and a browser field. Moving the caret, moving the pointer, switching apps, closing the target, or holding a modifier for three seconds refuses paste and retains the text. Retry saved output into a new target with no provider calls. | Changed destination | **Partial, Nov 9.** Native smoke target (WinForms text box): dictation pasted once; switching apps before release refused and kept the text; the shortcut pasted the saved output into the target in 0.64 s. Notepad/VS Code/browser targets, Unicode/multiline text, and the caret, pointer, closed-target and held-modifier variants pending. |
| Clipboard | Rich text (copy from Word or a browser) is restored after paste. `scripts/newer-copy-smoke.ps1` keeps the newer copy. Copy/Replace/Restore previous clipboard work. A clipboard held open by another app reports busy and keeps the text. | Physical microphone and targets | **Partial, Nov 9.** RTF + text clipboard restored after the insertion test and after dictation (native smoke). Newer copy, Copy/Replace/Restore and busy clipboard pending. |
| Hidden capture | Close the main window to the tray, then dictate: capture level and live words match the open-window run. Repeat with the window minimized. Note idle CPU with the window hidden for five minutes. | Tray/quit | **Partial, Nov 9.** Tray (window stayed hidden) and minimized runs both showed live words before release and produced a transcript of the synthetic phrase. Idle CPU pending. |
| New UI paths | With no key saved, test the microphone: record, play back, clear; no request is made. **Download recording** saves a WAV to Downloads and shows its path; a second save does not overwrite the first. | — | **Partial, Nov 9.** Download recording: two saves produced two distinct RIFF files in Downloads (native smoke, deleted afterwards). The no-key microphone test was not run natively; rendered UI "microphone-only mode captures without a key or provider calls" covers it. |
| Shortcut test mode | Switch Shortcut test mode to **Text insertion test**: the insertion status reads "Ready. The target will be captured on key-down." Switch back to **Dictate and insert**: it reads "Choose Text insertion test to check a destination." Each change updates the status once, with no "probe" wording. In insertion test mode, key-down captures Notepad and release inserts the test text. | — | **Pass (native smoke), Nov 9.** Both hints exact; insertion test mode inserted the test text into the harness target and restored the clipboard. |
| Settings after cleanup | Settings shows no Show/Hide overlay fixture buttons. Overlay status and live latency still render under the recording test. API-key, microphone and insertion-test sections contain no "probe" wording, apart from the native insertion test string shown in `#test-text` ("YapYap dictation insertion probe", kept to match the Rust `TEST_TEXT`). | — | **Pass (native smoke), Nov 9.** |
| Combined flow | Window in the tray: hold → speak → live overlay → full transcription → cleanup → paste into Notepad, three times in a row without discard. Earlier results stay viewable. | Repeat dictation | **Partial, Nov 9.** Native smoke ran tray dictation, minimized refusal + retry, Esc cancel and mic-only capture back to back without restarting. Three consecutive successful pastes into Notepad, and earlier results staying viewable, pending. |
| Privacy | After all checks, run `python desktop/scripts/audit-key-leaks.py --check-saved-key --check-app-data` from the repository root. No findings or unreadable files. | Release gate | **Pass, Nov 9**, with YapYap quit: 760 files and 978 Git objects, no exposures. With the app running, WebView2 holds `EBWebView\Default\Network\Cookies` open and the audit reports it unreadable (exit 2), so quit the app first. |

## Exit

Record observed results with date, Windows version and installer hash. A failure
is a gap: fix it, rerun the affected rows and the automated checks, and keep the
failure in this record. When every row passes, update the status in
[MACOS_PROBES.md](../../MACOS_PROBES.md) and the macOS checkpoint in
[TASKS.md](../../TASKS.md). Together, the shortcut, cancellation, combined-flow
and Task 17 permission/conflict rows can also close the open tray/hotkey check
under TASKS.md Task 12.
