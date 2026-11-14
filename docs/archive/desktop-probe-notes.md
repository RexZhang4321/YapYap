# Capability probe notes (archived)

Per-task implementation and manual-check notes from the Windows build (tasks 4–12), moved out of the desktop README. They describe the UI and helpers as they were at the time; some controls have since moved under Settings or Developer diagnostics.

## Floating live overlay (Tasks 8–9)

Recording shows a small always-on-top **Listening** panel with live words labelled **Provisional** when live preview is enabled. While connecting, recording continues; with preview disabled, the panel shows a fixed listening status. It displays the latest 2,048 UTF-16 units, preserves emoji at the tail boundary, wraps long identifiers, and follows the newest lines. The complete bounded live preview remains in the main probe. Release shows **Finalizing** with the provisional preview; a successful paste hides and clears the overlay. Failed recording/transcription/insertion and unresolved clipboard restoration keep **Needs attention** visible. Retained probe results show **Ready** until recovery or discard. Use the tray's **Open YapYap** action for existing Retry, Copy, Restore, and Discard controls. The panel ignores mouse input and never requests focus; destination capture completes before it appears. It sits near the bottom of the foreground application's monitor, within the work area.

The overlay has its own frontend entry point and event-subscription capability. Native dispatch permits only reading the bounded overlay snapshot; other application commands are denied. It receives provisional text, fixed preview status, and a gap flag; it receives no audio, credentials, or canonical transcript. Text is rendered as plain text. State updates are serialized, coalesced, and revisioned so cancellation/reload cannot apply an older status over a newer one. Hidden updates clear both the native snapshot and the overlay DOM. Overlay failures are reported in the main probe and do not cancel dictation. Preview failure shows a warning while capture continues; explicit reconnect marks the gap. Provisional text never enters the insertion path.

Task 9 manual Windows check: choose **Live transcription test (no insertion)**, enable live words, prepare the actual microphone, and focus a disposable Notepad/VS Code/browser input. Hold the shortcut for 8–15 seconds and confirm provisional words appear before release while focus/input contents stay unchanged. Release retains audio and performs no automatic insertion in this mode. Test preview failure/reconnect while capturing, then cancel/discard and confirm no late text reappears. For the original Task 9 baseline, bypass cleanup in normal dictate mode and confirm canonical insertion, Finalizing status, clipboard restoration, and success hiding. Real provider requests occur with live preview enabled. See [Task 9 verification](verification/task9-verification.md) for observed scope.

Manual Windows checks:

1. Prepare the microphone, focus a disposable input, hold the shortcut and release. Confirm Listening then Processing, no focus change, canonical insertion, and overlay hiding. This normal flow can make existing provider requests.
2. Cause a transcription or destination failure. Confirm the warning persists and audio/text recovery remains available through the tray. Retry or discard; verify that the warning clears when resolved.
3. Cancel during recording/startup/finalization; confirm the panel hides and no late response brings it back. Confirm an unresolved clipboard restoration keeps recovery visible even after paste dispatch.
4. Check multiple monitors and Windows display scales; verify the panel stays within the selected monitor's work area and ignores pointer input. Multi-monitor placement was observed, but a full DPI matrix remains a follow-up.

## Live transcription (Task 7)

**Show live words** is enabled by default. Microphone audio streams directly to OpenAI while the shortcut is held, and the separate **Provisional live transcript** view updates before release. Uncheck this option before recording to use only the existing whole-recording final transcription. The preview never supplies text for automatic insertion.

Choose **Live transcription test (no insertion)** for an isolated check. Prepare the microphone, hold the shortcut and speak, then release. This action leaves the original recording available for playback and **Retry transcription**; it does not capture an insertion destination or paste. An explicit transcription request produces a retained canonical transcript for Copy. Normal **Dictate and insert** continues to use the complete original audio for final transcription/insertion.

The latency display measures microphone capture-start to the first visible nonempty transcript update using the frontend monotonic clock. It includes live connection setup that overlaps capture; it is not measured from shortcut press and is not release-to-insertion latency. Initial synthetic measurements were 1.00–1.73 seconds; representative physical-microphone targets remain for evaluation.

On a live connection failure, recording continues and provisional words remain selectable. **Reconnect preview** is available while recording; it resumes from current microphone audio, preserves earlier text and marks the missing interval. Original audio is unaffected. A full queue stops the preview instead of dropping local recording samples. **Cancel and discard** clears live/canonical text and audio, closes the live connection and suppresses late events. A live finish never delays or replaces canonical transcription.

The native WebSocket uses the saved Windows credential against the fixed OpenAI host, certificate/hostname verification, no redirects, and 10-second connect/configuration/send/final-completion deadlines. Audio chunks cross binary IPC; only the preview copy is converted to 24 kHz PCM16 and Base64-encoded in Rust. The frontend queue holds at most 192,000 bytes plus one in-flight chunk; the native queue holds at most 32 chunks of 9,600 bytes. Provider events and the live view have 1 MiB limits. No audio, transcript or credential is written to ordinary logs or files. API/transport failures use fixed error codes; library/OS memory copies are not guaranteed to be wiped.

The protocol follows [OpenAI's live transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription). Turn detection is disabled for this single-turn probe; release sends the audio commit. Task 9 now displays the live preview in the passive overlay. Task 11 adds optional cleanup after canonical transcription. Local VAD and incremental final transcription remain later tasks.

Manual Windows check:

1. Select live probe mode, leave live words enabled, prepare the actual microphone and hold the shortcut for 8–15 seconds. Confirm words appear before release and record the displayed latency. Release, listen to the original recording, and discard.
2. Repeat while temporarily disconnecting the network after words appear. Confirm a visible live error, continued capture and retained provisional text. Restore the connection and reconnect while still recording; confirm the gap is marked. Release, play the complete recording and choose Retry transcription. Confirm canonical text covers the recording and audio is released only after usable canonical text exists.
3. Cancel both shortly after press and after live words appear. Confirm local text/audio clear and late events do not restore them; start another session after capture stops.
4. In normal dictate mode, focus a disposable external input and confirm release still inserts only canonical text. Test the existing changed-target/Copy recovery checks independently of the live view.

For configuration/account access without uploading audio, run the explicit opt-in probe from `src-tauri/`: `cargo test --lib --offline streaming::tests::saved_key_live_configuration_probe -- --ignored --exact`. It reads the saved credential only in Rust and returns fixed failures. Regular `npm test` and Rust tests use deterministic fakes/in-memory peers and make no API calls.

## Dictation session (Task 6)

Prepare the microphone, focus the intended external input, then hold the shortcut while speaking. Release sends the complete in-memory PCM16 mono WAV directly to OpenAI using the saved key, then inserts the selected final text at the captured destination: conservative cleanup when accepted, otherwise the exact canonical transcript. This mode uploads automatically on release; the optional live preview also streams audio while held and displays provisional words in the passive overlay. Task 11 adds optional cleanup and Copy original transcript. Segmentation remains deferred. Task 10 records combined single-segment checks and the remaining Windows verification gap.

The session has `idle`, `recording`, `finalizing`, `ready`, `inserted`, `failed`, and `discarded` states. Only one session is active. Successful canonical results are retained in memory when another dictation starts; unresolved failed audio must be retried or discarded first. A new hotkey press during finalization visibly explains that the session is busy. Capture failure, empty recordings, and microphone interruption remain recoverable or explicitly discardable. A disconnect retains partial audio for playback and an explicit Retry transcription instead of silently uploading it.

**Cancel and discard** works during recording and transcription. It stops capture, clears local audio/text, invalidates the destination, suppresses late responses, and immediately releases the local session lock. A sent native request still owns its upload buffers until it finishes; a new request encountering the native busy guard fails promptly with saved-audio retry guidance. Once native paste is dispatched, cancellation is disabled until the insertion result or the bounded uncertain-outcome timeout; paste cannot be undone by discarding.

Failed transcription keeps PCM/WAV/playback for **Retry transcription**. A usable canonical transcript releases audio and stays selectable until explicit discard or exit. If the focused input, available caret position, or pointer changes, insertion refuses and offers **Copy transcript**. A refusal confirmed before any paste attempt also permits retry by returning to the original input/caret and pointer position and pressing/releasing the shortcut. It retries insertion without another API request. Partial paste, unknown IPC outcomes, and clipboard restoration failures never permit automatic repeat insertion.

Copy transcript backs up supported clipboard formats. **Restore previous clipboard** is available afterward. If the clipboard cannot be backed up, **Replace clipboard with text** explicitly replaces it. Automatic paste restores its temporary clipboard only if no newer copy occurred. A successful paste and failed clipboard restore are reported separately; use Restore rather than inserting again. Sending paste keystrokes does not prove the destination accepted them. Target checks cannot prove that the user switched away and back or moved and restored a cursor between checks.

Audio is held in memory unless you explicitly choose **Download WAV**. WAV bytes cross binary Tauri IPC; Rust reads the key directly from Credential Manager. No credential is returned to the UI. Uploads are limited to 25,000,000 bytes and successful responses to 1 MiB. Native HTTPS verifies certificates and disables redirects. Resolve/connect timeouts are 10 seconds each. Native send/response work shares a 60-second elapsed budget; remaining time is applied before response receipt and each body read, so a trickling response cannot hold the request lock forever. DNS/connect retain their separate bounds, so the budget is not an exact wall-clock maximum for all OS phases. Ordinary logs contain no credentials, audio, or dictated text. HTTP 401 does not distinguish invalid, expired, and revoked keys. App exit/crash loses pending audio and transcripts.

Manual Windows checks:

1. Prepare the microphone, focus a blank Notepad/VS Code/browser input, hold for 5–10 seconds, then release. Bypass cleanup to verify exact canonical insertion, or compare accepted cleanup with Copy original transcript. Confirm playback disappears, original text remains, and the clipboard is restored. Discard before another dictation.
2. Switch apps, move the caret/pointer, or close the target during recording or finalization. Confirm no paste and retained text. Verify Copy and, for a confirmed refusal, the original-target hotkey retry.
3. Temporarily disconnect the network before release. Confirm retained audio and a visible failure. Reconnect and Retry transcription without recording again.
4. Cancel during recording, microphone startup, and transcription. Confirm local resources clear, no late result inserts/restores text, and another session starts after outstanding work completes. Press the hotkey during finalization and confirm the visible busy explanation.
5. Test Unicode, newlines, URLs, filenames, identifiers, numbers, and technical vocabulary. Check that repeated release/retry events cannot duplicate text, including a clipboard restoration failure.

Automated checks: `npm test` and `npm run build` here; `cargo test --lib --offline` and `cargo fmt --check` in `src-tauri/`. Regular tests use deterministic fakes and make no API calls. If Windows linker temporary-file access is restricted, create `target/task6-temp` and set process-local `TEMP` and `TMP` to its absolute path before Cargo.

## API-key storage probe

Enter your OpenAI API key in the masked field and choose **Save key**. The field clears immediately after submission. The app stores a generic credential at `com.jingxuan-zhang.yapyap/openai-api-key` in Windows Credential Manager for the current Windows user on this machine. The saved key is never returned to the UI; the UI requests only its presence. **Remove key** deletes the credential, and saving another key replaces it.

Saving does not require internet access. **Check connection** explicitly reads the saved credential in Rust and sends an authenticated `GET https://api.openai.com/v1/models` using the shared Rust HTTP client. Certificate verification is enabled, redirects are disabled, and connection checking has a 10-second overall timeout. No recording or transcript is sent. There are no background validation requests, and a failed request keeps the saved key. Validation uses fixed error codes; headers, secrets, and provider response bodies are not displayed or logged. Temporary Rust secret buffers are wiped on drop; this does not guarantee erasure of every WebView/IPC/OS memory copy.

The request follows the [OpenAI models API](https://developers.openai.com/api/reference/resources/models/methods/list). Success establishes access to the models endpoint, while transcription model access remains Task 5. A permission error may mean a restricted key cannot list models; it does not prove the key is invalid.

Manual Windows check:

1. Enter a key locally in the app and choose **Save key**. Confirm the field clears and the saved-key status appears.
2. Choose **Check connection**. Confirm successful validation, or record the displayed error without recording the key itself.
3. Use the tray menu's **Quit** action; closing the window only hides it. Run `npm run tauri dev` again. Confirm the key is still saved while the input remains empty, and validate without re-entering it.
4. Temporarily disconnect the network and validate again. Confirm a network/timeout error appears and the key is still saved. Restore the connection and retry.
5. Choose **Remove key**. Confirm the status says no key is saved and Validate is disabled. Save the desired key again if continuing with the transcription probe.
6. Confirm the app's event list and console contain no entered key and that no app-owned plaintext credential/settings file was created. The credential may be inspected or removed in Windows Credential Manager under Windows Credentials.

Record the observed results in [the decision log](../DECISIONS.md). Deterministic input/error tests run with `cargo test --lib` from `src-tauri/`. The native storage probe is opt-in: `cargo test --lib credentials::tests::windows_credential_restart_probe -- --ignored --exact`. It creates a unique disposable fixture credential, reads it from a fresh process, replaces it, deletes it, and checks removal; it does not read or replace the app's key. The separate opt-in network check is `cargo test --lib openai::tests::openai_rejects_invalid_fixture_key -- --ignored --exact`; it sends a deliberately invalid fixture key to OpenAI and reads no saved credential.

## Microphone capture checks

The original Task 3 recording/playback, permission denial, clearing, and disconnect/reconnect checks are recorded in [the decision log](../DECISIONS.md). Task 6 now automatically transcribes on release. A successful transcript releases playback/audio; playback remains available after transcription failure or microphone interruption.

Choose the input device in Settings or leave System default microphone selected. Access is checked automatically; use Allow microphone only to recover blocked access. The input meter should move while speaking. Capture uses mono Float32 PCM in memory and reports duration, sample rate, device, and AudioWorklet diagnostics for empty recordings. A stopped capture is encoded as in-memory PCM16 WAV. On macOS, WebKit withholds microphone audio from a hidden window and delivered very quiet samples, so the Mac build records natively with AVAudioEngine (`src-tauri/src/audio_capture.rs`) and streams the same mono Float32 chunks to the shared recorder contract; the WebView still lists devices and requests permission. Its diagnostics report tap callbacks and input channels in place of AudioWorklet values.

For current checks, follow the Task 6 matrix above. Confirm the live meter, successful transcription/insertion, and audio release. On microphone disconnect, confirm partial audio remains for playback and explicit Retry transcription; discard it, reconnect/refresh, and prepare again before another session. Permission errors should remain visible and the empty/failed session must be discardable. Quitting releases pending audio; explicitly downloaded files remain on disk.

## Text insertion probe

Put the caret in Notepad, VS Code, or a browser text field, then press and release the shortcut. On key-down the probe captures the foreground and focused window, caret rectangle when Windows provides one, and pointer position. After key-up it waits for modifier keys to be released, checks the target again, temporarily replaces the clipboard, sends Ctrl+V, and restores the saved formats if no newer copy occurred. Keep the pointer still during a normal insertion test. The probe refuses automatic paste when focus or the pointer/caret changes, a clipboard format cannot be backed up, or a Windows API call fails.

Before this check, choose **Text insertion test** under **Settings → Developer diagnostics → Shortcut test mode**.

**Copy test text** saves supported clipboard formats, then puts the fixed string on the clipboard. **Restore previous clipboard** becomes available after that Copy action; use it after pasting the test string. This includes rich clipboard formats backed by movable global memory. GDI/owner-rendered formats and clipboard content over 64 MiB are not supported by this probe; the safe Copy action leaves them untouched and explains why. **Copy without backup** explicitly replaces an unsupported clipboard, and Restore remains unavailable. Automatic paste normally restores its own temporary clipboard without needing the Restore button; the button also becomes available if that restoration fails.

Test the following cases and record the observed result in [the decision log](../DECISIONS.md):

1. Plain-text clipboard, then insert into Notepad, VS Code, and a Chrome or Edge input. Confirm both the pasted string and clipboard restoration.
2. Switch apps before releasing, move the pointer or caret before releasing, and close the target before releasing. Confirm no automatic paste and use Copy.
3. Copy different text immediately after release. Confirm the probe does not overwrite that newer copy.

The probe reports that paste keystrokes were sent, not that the destination accepted them; confirm insertion in the target. It can detect the current target and caret position, but cannot prove that an app was switched away and back during one hold or that an input accepted the paste. Closing the probe window hides it; use the tray menu to show it or quit.

For a repeatable Windows text-box check while the probe is running, use `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/insertion-smoke.ps1`. It opens a temporary focused input, sends real Windows key events, and reports inserted text and whether clipboard text matches its value before the test. Notepad, VS Code, and browser checks remain separate manual checks.

To check that a newer clipboard copy is preserved, run `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/newer-copy-smoke.ps1` while the probe is open. The script replaces the clipboard with disposable text. Within 15 seconds, focus a blank Notepad document and press Ctrl+Alt+F8. The script watches for the probe's temporary clipboard text, copies a newer marker, and reports whether the marker survives the probe's restore attempt.

## Single-segment integration (Task 10)

Normal **Dictate and insert** combines provisional overlay words with complete-original-audio final transcription and guarded canonical insertion. The overlay says **Finalizing** on release and hides immediately after successful paste/clipboard restoration; **Completed** and the retained canonical result remain in the main window. Live probe mode intentionally retains audio and does not paste.

The combined regression is documented in [Task 10 verification](verification/task10-verification.md). The combined native/live check remains unverified because desktop automation timed out before the test started; the combined-flow row of the [Windows regression checklist](../verification/windows-regression-verification.md) covers it. Earlier platform checks and regular deterministic tests pass.

## Conservative cleanup (Task 11)

**Light cleanup** is enabled by default. Disable it before recording to insert the canonical transcript directly; the choice is fixed for the session. After canonical transcription, the app sends that text directly to `gpt-6-luna` with minimal-edit instructions. Accepted cleanup supplies insertion and **Copy cleaned**. Failed, incomplete or rejected cleanup uses canonical text and shows a recovery notice; it does not block insertion. The original transcript stays available through **Copy original** until explicit discard or exit.

The guard permits only conservative edits and rejects changed lexical content/order or protected values. It may fall back on text that could have been acceptably cleaned. Neither the prompt nor the guard proves meaning preservation; the original and bypass remain available. No foreground application content is collected. Cleanup uses native saved-key access, fixed HTTPS endpoints, bounded payloads and `store: false`; dictated text is not written to app logs/files. Provider-side retention is governed by the account/provider policy.

See [Task 11 verification](verification/task11-verification.md) for deterministic/API checks and the manual comparison/cancellation checklist.

## Failure recovery (Task 12)

Failed or malformed canonical transcription retains the original audio for **Retry transcription**. Cleanup failure uses the exact canonical fallback. Insertion failure retains original, accepted cleaned and provisional text; only a confirmed refusal before paste permits insertion retry without another provider request. An uncertain or partial paste requires checking the destination before explicit Copy/paste.

**Copy live words** presents the exact available snapshot for explicit confirmation, even if live preview is still finishing. It warns that words may be incomplete, inaccurate or contain gaps and are not the final transcript. It does not replace canonical text. Processing bypass also requires this confirmation and stops waiting before copying. Copy uses the same clipboard backup/Restore behavior; its no-backup counterpart explicitly replaces unsupported clipboard content.

Cancellation clears local session sources, immediately unlocks the local session, and suppresses late results. Native request guards can briefly refuse a new request until their bounded send/response work finishes; the app retains the new recording for retry and reports that condition. Paste cannot be cancelled after dispatch; an insertion wait timeout exposes an uncertain outcome for manual recovery. Exit or crash loses pending audio, transcripts and in-memory clipboard backups.

See [Task 12 verification](verification/task12-verification.md) for the recovery matrix and final checks. Milestone 2 implementation is complete; the full new combined Windows manual validation remains pending as recorded in Task 10.
