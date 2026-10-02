# Task 6 Windows verification

Recorded during the October 1–2, 2026 development session.

The speech fixture was synthesized locally with Windows `System.Speech`, using 16 kHz mono PCM16. Its fixed phrase is: “Hello from the dictation test. The meeting starts at three thirty. Please save the project tomorrow.” No paid TTS service or virtual audio driver was needed. Only synthetic audio was sent to OpenAI; the saved credential stayed in Rust/Windows Credential Manager.

## Observed integration results

- WebView2 enumerated Fake Default Audio Input and two other fake inputs. Prepare microphone succeeded at 44,100 Hz; the normal AudioWorklet capture and WAV encoding path ran.
- An eight-second session automatically transcribed and inserted into a blank Notepad tab. The app reached `inserted`, recognized the synthetic phrase, reported clipboard restoration, hid playback, and showed no recording retained. The actual Notepad text was visually verified: “Hello from the dictation test. The meeting starts at 3:30. Please save the project tomorrow.” It contained 92 characters.
- The same eight-second pipeline inserted that phrase into a disposable VS Code Untitled buffer, visually verified in the editor. No repository document was edited through the paste check.
- An earlier run refused insertion with a caret-change warning and retained the transcript. A real Windows Ctrl+Alt+F8 press/release retried insertion successfully into Notepad without retranscribing. Its clipboard was restored. Target checks remain deliberately conservative.
- A direct native insertion fixture preserved Chinese text, emoji, three lines, `https://example.com/a?q=2`, `src/main.ts`, `AS5047P`, `user_id`, and `12.50`, visually verified in Notepad. Repeating the native command for the same session refused a second paste.
- Capturing a Notepad destination and switching to VS Code before insertion returned a changed-input refusal without paste. Native Copy transcript succeeded with a clipboard backup; the text was pasted into another disposable Notepad tab. Restore previous clipboard succeeded and the pending backup cleared.
- Cancelling 100 ms after recording startup reached `discarded`, cleared audio/text, and retained no recording. This was repeated after the final frontend changes; Cancel remained enabled during capture.
- A source edit caused one Vite reload during an attempted check. That interrupted run was excluded; the successful eight-second checks were rerun after source edits settled.

## Test boundaries

The long recording checks replayed Pressed/Released events through the actual registered Tauri shortcut handler using the development debugger. Microphone-stream capture, AudioWorklet processing, encoding, binary IPC, native HTTPS/OpenAI transcription, Windows destination checks, paste, and clipboard restoration were real. The real shortcut was separately exercised for insertion retry. These checks do not replace another full physical-microphone hold-to-talk check or a new browser-input check; Tasks 1–3 already record those earlier platform probes.

Deterministic session tests cover cancelled late success/failure, cancellation during WAV conversion/target capture, native-work completion before a new session, transcription retry with the same audio, unavailable targets, insertion retry before paste only, partial/unknown paste outcomes, restoration failure, and the noncancellable paste commit boundary. Rust checks cover target changes, stale session IDs, native duplicate prevention, payload preservation/validation, and paste outcome versus clipboard restoration.

Repeatable integration setup is in [the README](../README.md). The fake-microphone/debug flags are process-local and must be absent from the normal app launch. Synthetic WAV output is ignored under `src-tauri/target/task6/`; no real recording or dictated transcript is written to disk by the app or helper.
