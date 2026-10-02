# Windows capability probes

Run `npm install` and `npm run tauri dev` from this directory. The app registers `Ctrl+Alt+F8` by default; enter another Tauri accelerator and choose **Apply** to change it. The default hotkey action records microphone audio. Choose **Run text insertion probe** to use the completed fixed-text probe.

## File-transcription probe (Task 5)

Prepare the microphone, hold the recording shortcut while speaking, then release. Stop playback before choosing **Transcribe recording**. This explicitly sends the complete in-memory PCM16 mono WAV to OpenAI's `/v1/audio/transcriptions` endpoint with `gpt-transcribe` and the saved key. There is no audio upload on recording stop or app startup. WAV data crosses Tauri IPC as binary bytes, and Rust reads the key directly from Credential Manager; no secret is returned to the UI and no audio file is written.

The canonical transcript appears in a read-only selectable text field. On success, the app releases the recording PCM, WAV, and playback URL and retains the transcript until explicit discard or app exit. Failed or empty responses keep the recording for playback and **Retry transcription**. **Discard recording and transcript** clears local audio/text and suppresses late responses. If an upload is already in flight, its request buffers remain owned by the native worker until it finishes; discard cannot retract uploaded audio. Recording another session remains disabled while that request finishes, and a retained transcript must be explicitly discarded before another recording starts. **Clear recording** also discards the stopped recording.

The probe limits WAV uploads to 25,000,000 bytes and successful response bodies to 1 MiB. Native HTTPS uses certificate verification and disables redirects. Resolve/connect timeouts are 10 seconds each, and send/receive timeouts are 60 seconds each for transcription (these are phase timeouts, not one total request deadline). Provider error bodies, credentials, audio, and transcripts are not written to ordinary logs. The endpoint and model follow the [official OpenAI file-transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text). HTTP 401 cannot distinguish an invalid key from an expired or revoked one.

Manual Windows checks:

1. Save your key locally, prepare the microphone, and record 5–10 seconds of speech. Listen to confirm the capture, stop playback, and choose **Transcribe recording**. Confirm the transcript matches your speech, the playback disappears, and the transcript remains selectable. Account/model access is only verified by a successful transcription.
2. Choose **Discard recording and transcript**. Confirm no transcript or playback remains and a new recording can start.
3. Record again, temporarily disconnect the network, and transcribe. Confirm an error and retained playback. Reconnect and choose **Retry transcription** without recording again; confirm success.
4. Record again and choose Transcribe followed immediately by Discard. Confirm local text/audio clear, no late response restores them, and another recording can start after the outstanding request finishes. Also confirm repeated transcription clicks cannot send duplicate requests.
5. With no request in progress, temporarily remove the saved key, record, and transcribe. Confirm the missing-key message retains audio. Save the key again locally and retry. For an invalid-key check, use the opt-in fixture probe below instead of replacing your saved key with an invalid value.

Record observed results in `../DECISIONS.md`. Task 5's completion criteria are verified: the user confirmed successful spoken-audio transcription and the failed-request retry flow. Release/discard and late-response behavior have deterministic test coverage; their separate manual checks remain useful for the later lifecycle audit. Automatic insertion is Task 6.

Run `npm test` (Node 22.14 or newer with experimental TypeScript transformation) and `npm run build` here; run `cargo test --lib --offline` and `cargo fmt --check` in `src-tauri/`. The opt-in endpoint test is `cargo test --lib transcription::tests::openai_rejects_invalid_transcription_key -- --ignored --exact`; it sends synthetic silence with an invalid fixture key and never reads the saved credential. Regular tests use deterministic fakes and make no network requests.

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

## Microphone recording probe

Choose the input device or leave **System default microphone** selected. Click **Prepare microphone** and wait for the ready message before using the shortcut; this requests permission and resolves device labels before a hold begins. Then hold the shortcut while speaking and release it to stop. The live input meter should move while you speak. The probe captures mono Float32 PCM in memory, reports the captured duration, sample rate, channel count, and input device, and creates an in-memory PCM16 WAV for playback. Use **Play captured audio** or the audio controls to listen, **Stop playback** to restart, and **Clear recording** to release the PCM and playback data. Audio is never written to disk; quitting the app also releases it.

Manual Windows check:

1. Click **Prepare microphone** and allow access. Select **Mic In (2- Elgato Wave:3)** if it is listed, or use the system default. Wait for the ready message, then hold the shortcut, speak for 5–10 seconds, and release it.
2. Confirm the input meter moves while speaking, the metadata is plausible, and **Play captured audio** plays the captured speech. If the duration is zero, note the diagnostic values shown in the metadata.
3. Select **Clear recording** and confirm the player disappears and the metadata says no recording is retained.
4. Temporarily deny desktop microphone access in Windows Privacy & security settings and click **Prepare microphone**. Confirm a visible permission error appears without crashing; restore access and prepare again afterward.
5. Start another recording, disconnect the microphone while recording, then reconnect it. Confirm the partial capture is retained for playback, clear it, refresh the device list, and verify a new recording can start.

Record the observed results in `../DECISIONS.md`. The probe reports audio frames received by the browser audio graph; confirm the recording by listening to it.

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
