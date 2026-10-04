# Task 8 Windows verification

Recorded on October 3, 2026 (America/Los_Angeles).

## Implementation and observed results

- Added a separate 440 × 148 logical-pixel status WebView, hidden at startup, always on top, nonfocusable, without taskbar entry or window decorations, and mouse-through. Windows shows it with `ShowWindow(SW_SHOWNOACTIVATE)` and hides it with the matching native path. The main probe remains the session/audio owner and tray-accessible recovery surface.
- The overlay receives only an ownership generation, a revision number, and a fixed status enum. It renders fixed copy for Listening, Processing, Ready, and Needs attention. No live or canonical transcript, audio, or credential is sent to it. Native command dispatch rejects all application commands from this WebView except `overlay_snapshot`; its capability permits event listen/unlisten only.
- Real Windows observations confirmed `WS_EX_NOACTIVATE`, `WS_EX_TOPMOST`, and `WS_EX_TRANSPARENT`. Notepad retained foreground handle 133720 while the overlay was visible during recording and delayed finalization. The observer recorded an overlay rectangle of `[1052, 1211, 1508, 1368]` on that monitor. Visible Listening/Processing/Needs attention layouts were reviewed with Windows window screenshots.
- Cancellation during a delayed final-STT fixture reached discarded, released audio, hid the overlay, and suppressed the late result. No transcript or paste was restored.
- A fixed final-STT failure reached failed with original synthetic capture/playback retained and a persistent Needs attention warning. Explicit retry used that retained audio and the local success fixture. Native destination validation, clipboard backup/paste/restoration, and overlay hiding were real. A Windows screenshot visibly confirmed `Task 8 fixed canonical text` in the disposable Notepad tab. The final session remained inserted with audio released and transcript retained; the native observer confirmed the overlay was hidden and Notepad remained foreground.
- VS Code's window remained foreground (handle 1246904) while the overlay was shown. Placement followed the other monitor, with negative-X rectangle `[-1508, 1211, -1052, 1368]`. Its terminal was focused during that initial check; fixed fixture text reached the prompt without command submission. An attempted editor-target setup encountered stale accessibility state. No new VS Code editor insertion pass is claimed.
- A disposable local browser textarea was created, but browser-tool interaction did not bring Chrome to the Windows foreground. Further Windows browser observation was stopped by the tooling's browser URL-policy check. No browser focus/insertion pass is claimed.
- The overlay security check confirmed that `has_api_key` is denied while `overlay_snapshot` works, and that the overlay contains no credential or microphone controls.

## Test boundaries

All Task 8 integration requests were local. Capture used the existing ignored synthetic WAV and WebView2 Fake microphone; final STT returned a fixed local fixture, and live streaming was disabled. Shortcut events were replayed through the actual registered callback. No API requests, physical-microphone claims, paid calls, or credential changes were made. Native window management, destination capture, clipboard handling, and Notepad paste were real. A full mixed-DPI/resolution matrix, physical hotkey hold, browser input, and fresh VS Code editor check remain useful manual follow-ups.

Sandboxed app launches did not expose usable WebViews, and sandboxed native observation could not find the user's windows. The app and read-only window observer worked in the normal Windows desktop/user context. Task-created app processes are stopped after testing; process-local debugger/fake-device flags and frontend fixture patches are not persisted.

## Deterministic checks

- Frontend tests cover normal session/insertion/live behavior plus status recovery, clipboard restoration warnings, serialized/coalesced updates, slow native failure followed by discard, and late-response suppression.
- Native tests cover fixed snapshot enums, rejection of arbitrary payload fields, and suppression of older-owner/revision updates after reload or discard. The window observer is skipped by ordinary tests. The ownership-generation hardening followed the real-window check and was verified deterministically; no further browser/UI pass is claimed.
- Final checks: 34 frontend tests and 20 native tests passed (six explicit native helpers skipped). Frontend production build, native debug build, Rust formatting, helper syntax, and Git whitespace checks passed. A pattern-only audit scanned 96 files/build outputs and 308 local Git objects with no matching key exposures; it did not retrieve the saved key or audit app data.

Repeatable local setup and manual checks are in [the README](../README.md). Task 8's completion criterion—overlay lifecycle while an external target remains active—is verified through Notepad. Next: Task 9, connect provisional live deltas to the overlay.
