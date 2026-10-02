# Windows capability probes

Run `npm install` and `npm run tauri dev` from this directory. The app registers `Ctrl+Alt+F8` by default; enter another Tauri accelerator and choose **Apply** to change it. The default hotkey action records, transcribes, and inserts on release. Choose **Run text insertion probe** to use the completed fixed-text probe.

## Dictation session (Task 6)

Prepare the microphone, focus the intended external input, then hold the shortcut while speaking. Release sends the complete in-memory PCM16 mono WAV directly to OpenAI using the saved key, then inserts the exact canonical transcript at the captured destination. This mode uploads automatically on release. Streaming, overlays, cleanup, and segmentation come in later tasks.

The session has `idle`, `recording`, `finalizing`, `ready`, `inserted`, `failed`, and `discarded` states. Only one session is active. Discard a retained result before recording again; a new hotkey press during finalization visibly explains that the session is busy. Capture failure, empty recordings, and microphone interruption remain recoverable or explicitly discardable. A disconnect retains partial audio for playback and an explicit Retry transcription instead of silently uploading it.

**Cancel and discard** works during recording and transcription. It stops capture, clears local audio/text, invalidates the destination, and suppresses late responses. A sent native request still owns its upload buffers until it finishes, so another dictation waits for its completion. Once native paste is dispatched, cancellation is disabled until the insertion result arrives; paste cannot be undone by discarding.

Failed transcription keeps PCM/WAV/playback for **Retry transcription**. A usable canonical transcript releases audio and stays selectable until explicit discard or exit. If the focused input, available caret position, or pointer changes, insertion refuses and offers **Copy transcript**. A refusal confirmed before any paste attempt also permits retry by returning to the original input/caret and pointer position and pressing/releasing the shortcut. It retries insertion without another API request. Partial paste, unknown IPC outcomes, and clipboard restoration failures never permit automatic repeat insertion.

Copy transcript backs up supported clipboard formats. **Restore previous clipboard** is available afterward. If the clipboard cannot be backed up, **Copy transcript without backup** explicitly replaces it. Automatic paste restores its temporary clipboard only if no newer copy occurred. A successful paste and failed clipboard restore are reported separately; use Restore rather than inserting again. Sending paste keystrokes does not prove the destination accepted them. Target checks cannot prove that the user switched away and back or moved and restored a cursor between checks.

Audio is never written to disk. WAV bytes cross binary Tauri IPC; Rust reads the key directly from Credential Manager. No credential is returned to the UI. Uploads are limited to 25,000,000 bytes and successful responses to 1 MiB. Native HTTPS verifies certificates and disables redirects. Resolve/connect timeouts are 10 seconds each; send/receive timeouts are 60 seconds each (phase timeouts, not one overall deadline). Ordinary logs contain no credentials, audio, or dictated text. HTTP 401 does not distinguish invalid, expired, and revoked keys. App exit/crash loses pending audio and transcripts.

Manual Windows checks:

1. Prepare the microphone, focus a blank Notepad/VS Code/browser input, hold for 5–10 seconds, then release. Confirm canonical text is inserted, playback disappears, the transcript remains, and the clipboard is restored. Discard before another dictation.
2. Switch apps, move the caret/pointer, or close the target during recording or finalization. Confirm no paste and retained text. Verify Copy and, for a confirmed refusal, the original-target hotkey retry.
3. Temporarily disconnect the network before release. Confirm retained audio and a visible failure. Reconnect and Retry transcription without recording again.
4. Cancel during recording, microphone startup, and transcription. Confirm local resources clear, no late result inserts/restores text, and another session starts after outstanding work completes. Press the hotkey during finalization and confirm the visible busy explanation.
5. Test Unicode, newlines, URLs, filenames, identifiers, numbers, and technical vocabulary. Check that repeated release/retry events cannot duplicate text, including a clipboard restoration failure.

Automated checks: `npm test` and `npm run build` here; `cargo test --lib --offline` and `cargo fmt --check` in `src-tauri/`. Regular tests use deterministic fakes and make no API calls. If Windows linker temporary-file access is restricted, create `target/task6-temp` and set process-local `TEMP` and `TMP` to its absolute path before Cargo.

### Opt-in synthetic-microphone check

This development check uses local Windows speech synthesis instead of paid TTS. The generated WAV contains only a fixed synthetic phrase and lives under ignored `src-tauri/target/task6/`; it is not a real recording. Start Vite with `npm run dev`, build the native app, then launch a separate app process with these process-local variables (do not persist them in Windows settings):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-task6-speech.ps1
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=src-tauri/target/task6/speech.wav --remote-debugging-port=9223'
Start-Process -FilePath 'src-tauri/target/debug/desktop.exe' -WindowStyle Hidden
node scripts/task6-webview-check.mjs prepare
```

Focus a disposable blank editor, then from a separate terminal run `node scripts/task6-webview-check.mjs record --live`. The explicit flag authorizes uploading synthetic audio using the saved key. The helper prints state/recognition/resource checks without printing credentials or transcripts. `status` and `discard` are also supported. Avoid source edits/Vite reloads during a recording. Quit the test process afterward and launch normally, with the test flags absent.

The debugger replays Pressed/Released events through the actual registered shortcut handler. Capture, encoding, IPC, OpenAI transcription, target checks, Windows paste, and clipboard restoration are real. This verifies the pipeline with a simulated microphone; physical microphone behavior and the full Windows hold duration are separate checks. A real Windows shortcut was also verified for insertion retry. See [Task 6 verification](scripts/task6-verification.md) for observations.

WebView2 process-local browser flags follow [Microsoft's documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags); the audio fixture flag is implemented in [Chromium's media switches](https://chromium.googlesource.com/chromium/src/+/b45be0604d27b3e644978e57f581e810a65edca5/media/base/media_switches.cc).

## API-key storage probe

Enter your OpenAI API key in the masked field and choose **Save key**. The field clears immediately after submission. The app stores a generic credential at `app.byokdictation.hotkeyprobe/openai-api-key` in Windows Credential Manager for the current Windows user on this machine. The saved key is never returned to the UI; the UI requests only its presence. **Remove saved key** deletes the credential, and saving another key replaces it.

Saving does not require internet access. **Validate saved key** explicitly reads the saved credential in Rust and sends an authenticated `GET https://api.openai.com/v1/models` using Windows WinHTTP. Certificate verification is enabled, redirects are disabled, and resolve/connect/send/receive timeouts are each 10 seconds. No recording or transcript is sent. There are no background validation requests, and a failed request keeps the saved key. Validation uses fixed error codes; headers, secrets, and provider response bodies are not displayed or logged. Temporary Rust secret buffers are wiped on drop; this does not guarantee erasure of every WebView/IPC/OS memory copy.

The request follows the [OpenAI models API](https://developers.openai.com/api/reference/resources/models/methods/list). Success establishes access to the models endpoint, while transcription model access remains Task 5. A permission error may mean a restricted key cannot list models; it does not prove the key is invalid.

Manual Windows check:

1. Enter a key locally in the app and choose **Save key**. Confirm the field clears and the saved-key status appears.
2. Choose **Validate saved key**. Confirm successful validation, or record the displayed error without recording the key itself.
3. Use the tray menu's **Quit** action; closing the window only hides it. Run `npm run tauri dev` again. Confirm the key is still saved while the input remains empty, and validate without re-entering it.
4. Temporarily disconnect the network and validate again. Confirm a network/timeout error appears and the key is still saved. Restore the connection and retry.
5. Choose **Remove saved key**. Confirm the status says no key is saved and Validate is disabled. Save the desired key again if continuing with the transcription probe.
6. Confirm the app's event list and console contain no entered key and that no app-owned plaintext credential/settings file was created. The credential may be inspected or removed in Windows Credential Manager under Windows Credentials.

Record the observed results in `../DECISIONS.md`. Deterministic input/error tests run with `cargo test --lib` from `src-tauri/`. The native storage probe is opt-in: `cargo test --lib credentials::tests::windows_credential_restart_probe -- --ignored --exact`. It creates a unique disposable fixture credential, reads it from a fresh process, replaces it, deletes it, and checks removal; it does not read or replace the app's key. The separate opt-in network check is `cargo test --lib openai::tests::openai_rejects_invalid_fixture_key -- --ignored --exact`; it sends a deliberately invalid fixture key to OpenAI and reads no saved credential.

## Microphone capture checks

The original Task 3 recording/playback, permission denial, clearing, and disconnect/reconnect checks are recorded in `../DECISIONS.md`. Task 6 now automatically transcribes on release. A successful transcript releases playback/audio; playback remains available after transcription failure or microphone interruption.

Choose the input device or leave System default microphone selected, then click Prepare microphone before using the shortcut. The input meter should move while speaking. Capture uses mono Float32 PCM in memory and reports duration, sample rate, device, and AudioWorklet diagnostics for empty recordings. A stopped capture is encoded as in-memory PCM16 WAV.

For current checks, follow the Task 6 matrix above. Confirm the live meter, successful transcription/insertion, and audio release. On microphone disconnect, confirm partial audio remains for playback and explicit Retry transcription; discard it, reconnect/refresh, and prepare again before another session. Permission errors should remain visible and the empty/failed session must be discardable. Quitting releases pending audio; no microphone recording is saved to disk.

## Text insertion probe

Put the caret in Notepad, VS Code, or a browser text field, then press and release the shortcut. On key-down the probe captures the foreground and focused window, caret rectangle when Windows provides one, and pointer position. After key-up it waits for modifier keys to be released, checks the target again, temporarily replaces the clipboard, sends Ctrl+V, and restores the saved formats if no newer copy occurred. Keep the pointer still during a normal insertion test. The probe refuses automatic paste when focus or the pointer/caret changes, a clipboard format cannot be backed up, or a Windows API call fails.

Before this check, choose **Run text insertion probe** under **Hotkey action**.

**Copy test text** saves supported clipboard formats, then puts the fixed string on the clipboard. **Restore previous clipboard** becomes available after that Copy action; use it after pasting the test string. This includes rich clipboard formats backed by movable global memory. GDI/owner-rendered formats and clipboard content over 64 MiB are not supported by this probe; the safe Copy action leaves them untouched and explains why. **Copy without backup** explicitly replaces an unsupported clipboard, and Restore remains unavailable. Automatic paste normally restores its own temporary clipboard without needing the Restore button; the button also becomes available if that restoration fails.

Test the following cases and record the observed result in `../DECISIONS.md`:

1. Plain-text clipboard, then insert into Notepad, VS Code, and a Chrome or Edge input. Confirm both the pasted string and clipboard restoration.
2. Switch apps before releasing, move the pointer or caret before releasing, and close the target before releasing. Confirm no automatic paste and use Copy.
3. Copy different text immediately after release. Confirm the probe does not overwrite that newer copy.

The probe reports that paste keystrokes were sent, not that the destination accepted them; confirm insertion in the target. It can detect the current target and caret position, but cannot prove that an app was switched away and back during one hold or that an input accepted the paste. Closing the probe window hides it; use the tray menu to show it or quit.

For a repeatable Windows text-box check while the probe is running, use `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/insertion-smoke.ps1`. It opens a temporary focused input, sends real Windows key events, and reports inserted text and whether clipboard text matches its value before the test. Notepad, VS Code, and browser checks remain separate manual checks.

To check that a newer clipboard copy is preserved, run `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/newer-copy-smoke.ps1` while the probe is open. The script replaces the clipboard with disposable text. Within 15 seconds, focus a blank Notepad document and press Ctrl+Alt+F8. The script watches for the probe's temporary clipboard text, copies a newer marker, and reports whether the marker survives the probe's restore attempt.
