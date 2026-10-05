# BYOK Dictation for Windows

Run `npm install` and `npm run tauri dev` from this directory. The initial release targets Windows. The normal flow is **hold shortcut → speak → release → insert**; the app stays available in the system tray when its window closes.

To launch the native client from the repository root, run `cd desktop`, then `npm run tauri -- dev`. Tauri starts Vite automatically; do not start a separate `npm run dev` first. If startup reports **Port 1420 is already in use**, stop the earlier Vite/Tauri terminal with Ctrl+C and retry. `npm run dev` alone is only the browser frontend and does not provide native dictation capabilities.

Keep one native client instance running; closing its main window leaves it active in the tray. Use the tray's **Quit** command before starting a replacement. The browser recovery fixture has a separate Vite dependency cache, so its tests can run alongside the native development client without invalidating the floating overlay's modules.

## Frontend development

Both windows use React 19 and TypeScript, built with Vite. `index.html` and `overlay.html` mount separate React roots; their existing CSS and native Tauri capabilities remain in place.

- `src/ui/App.tsx` composes the main window and owns Settings navigation and native dialog refs.
- `src/ui/Home.tsx`, `SettingsContent.tsx`, `ApiKeySettings.tsx`, `SessionRecovery.tsx`, and `RetainedList.tsx` contain the feature components. Retained rows use session IDs as React keys to preserve expansion and focus during updates.
- `src/ui/store.ts` exposes cached view snapshots through React's `useSyncExternalStore`; `View.tsx` binds typed HTML props, controlled inputs, status text, and controller actions. Initial display values live in `initialState.ts`. Add new UI features in these components, using local React state for presentation and extending the store only when session logic needs to publish a value.
- `src/dictationController.ts` owns the application session for the lifetime of the WebView. React renders its state; component renders and refreshes do not register another global shortcut or start another recorder. Native refs are used for playback, modal dialogs, and focus. The recording, transport, transcription, and recovery modules retain their existing responsibilities.
- `src/overlay.tsx` renders the passive overlay and disposes its event subscription on unmount. Revision checks, provisional-text separation, and scrolling to the latest words remain in place.

API-key drafts stay in an uncontrolled password input and are cleared synchronously before IPC. They never enter shared view snapshots or persisted preferences.

Use `npm run dev` for browser development, `npm run build` for TypeScript checking and both production entry points, and `npm test` for the session and view-store regressions. `npm run test:ui` runs ten rendered React checks using installed Microsoft Edge and a local fixture server on port 1424. These checks stub credentials, microphone, provider, clipboard, shortcuts, and insertion; they make no provider requests or native paste operations. Windows tray, physical-microphone, focus preservation, and real insertion acceptance still require the native checks below. `npm run format:ui` formats the React UI sources.

## Set up once

1. Open **Settings** or choose **Set up dictation** from the readiness screen.
2. Paste your OpenAI API key and choose **Save key**. The masked field clears immediately. The key stays in Windows Credential Manager; the application reads only its presence on launch. **Check connection** is optional and makes no recording upload.
3. Allow microphone access when prompted. The application checks readiness automatically after a key is saved. If access is blocked, Settings explains the problem and offers **Allow microphone** to retry. Choose a microphone or leave the system default selected.
4. Keep the default `Ctrl+Alt+F8`, or choose **Record shortcut**, then press and release your key combination to save it automatically. Esc cancels shortcut recording. A conflict leaves the previous shortcut available. Microphone selection, shortcut, live preview, and cleanup preferences are remembered on this Windows account.

## Dictate from the tray

Place the cursor in the intended text field, hold the shortcut, and speak. The passive floating window shows Listening and provisional live words. Release the shortcut to transcribe the complete recording, optionally tidy the text, and insert it. Keep the intended destination/cursor unchanged while the result finishes. A successful insertion hides the floating window, and you can dictate again without discarding the previous result.

Press **Esc** while recording or finalizing to cancel before insertion is dispatched, or open **Dictation** from the tray and choose **Cancel dictation**. If another application prevents global Esc registration, the app shows that limitation and keeps the Cancel button available. Cancel clears the current session's local audio/text and unlocks the local session immediately; late responses are ignored. An already sent native request can still finish in the background. If a new transcription reaches its native busy guard, the app retains the new recording and explains how to retry shortly. A paste already dispatched cannot be cancelled.

**Show live words** and **Light cleanup** are in Settings. Live words are a preview; the final transcript always uses the original recording. Turn cleanup off to insert the original transcript. Cleanup failure uses the original words. Audio and transcripts go directly to OpenAI; no dictation service or analytics receives them.

## Recover your words

The main window shows the specific issue and recovery actions while processing, after failure, and when clipboard restoration fails. Failed transcription retains audio for **Retry transcription** and playback. If insertion is refused before any paste, or destination capture fails, focus your intended text field and press and release your shortcut again. This explicitly chooses that input and pastes the saved output without recording, retranscribing, or repeating cleanup. The input must remain unchanged during this retry's native checks. The alert includes the native refusal reason. An uncertain or partially dispatched paste cannot be retried with the shortcut; check the destination and use Copy for manual recovery. **Discard dictation** clears the current sources and dismisses its floating alert; it cannot retract an existing paste.

While processing, **Stop waiting · keep recovery** immediately unlocks the local session and preserves the recording or original transcript. **Skip cleanup · review original…** shows the exact canonical original with an unpolished-text warning. **Use live words · review…** shows the exact provisional snapshot and warns that it may be incomplete, contain gaps or recognition errors, and is not the final transcript. **Confirm and copy** stops waiting and copies only the displayed text. Return to the intended field and press Ctrl+V to paste manually. Dismissing the dialog keeps waiting and does not copy or cancel anything. Provisional text is never promoted to canonical text or passed to automatic insertion. **Copy live words** after failure uses the same confirmation.

After 12 seconds, a stalled stage shows an actionable alert. Final transcription has a 100-second frontend deadline and preserves retry audio on timeout. Cleanup has a 30-second deadline and falls back to the original. Destination capture and insertion waits are bounded; a timed-out paste is treated as an uncertain outcome and cannot be automatically retried.

**Copy original** and **Original transcript** keep the canonical words available separately from cleanup. Earlier successful results move into **Saved for this session** as you dictate again; each can be copied or discarded. These results exist only in memory. Discard and quitting clear them; there is no permanent history or crash recovery.

Copy preserves supported clipboard contents for **Restore previous clipboard**. If preservation fails, **Clipboard options** offers an explicit **Replace clipboard** action. A newer user copy is not overwritten by automatic clipboard restoration.

## Developer diagnostics and verification

Open **Settings → Developer diagnostics** for the optional live/transcription and insertion test modes, microphone level/metadata, latency, and fixed event logs. This area is closed by default. Leave **Shortcut test mode** on **Dictate and insert** for normal use; live test mode intentionally retains audio and does not insert on release.

Regular checks are `npm test`, `npm run build`, and, from `src-tauri/`, `cargo test --lib --offline` plus `cargo fmt --check`. Regular tests use local fixtures and make no provider requests. The recovery follow-up passes all 140 deterministic frontend tests and the production build, plus 26 native tests (seven opt-in tests ignored). The earlier rendered browser checks passed setup/settings focus, shortcut-capture Escape cancellation, closed diagnostics, and 380 × 430 layout without horizontal overflow. That browser had no Tauri IPC; native tray, microphone, global shortcut/cancellation, preference restoration, and complete paste/recovery acceptance remain pending. See [UX verification](scripts/ux-verification.md) and [TASKS.md](../TASKS.md). Task 10's earlier combined Windows gap remains open. No Milestone 3 processing work is included.

The references below retain detailed capability implementation and opt-in development checks. Historical task notes describe the UI used at that time; current controls are grouped under Settings, recovery, or Developer diagnostics as described above. Real-provider checks are opt-in and may incur API usage.

## Floating live overlay (Tasks 8–9)

Recording shows a small always-on-top **Listening** panel with live words labelled **Provisional** when live preview is enabled. While connecting, recording continues; with preview disabled, the panel shows a fixed listening status. It displays the latest 2,048 UTF-16 units, preserves emoji at the tail boundary, wraps long identifiers, and follows the newest lines. The complete bounded live preview remains in the main probe. Release shows **Finalizing** with the provisional preview; a successful paste hides and clears the overlay. Failed recording/transcription/insertion and unresolved clipboard restoration keep **Needs attention** visible. Retained probe results show **Ready** until recovery or discard. Use the tray's **Open Dictation** action for existing Retry, Copy, Restore, and Discard controls. The panel ignores mouse input and never requests focus; destination capture completes before it appears. It sits near the bottom of the foreground application's monitor, within the work area.

The overlay has its own frontend entry point and event-subscription capability. Native dispatch denies it all application commands except reading the bounded overlay snapshot. It receives provisional text, fixed preview status, and a gap flag; it receives no audio, credentials, or canonical transcript. Text is rendered as plain text. State updates are serialized, coalesced, and revisioned so cancellation/reload cannot apply an older status over a newer one. Hidden updates clear both the native snapshot and the overlay DOM. Overlay failures are reported in the main probe and do not cancel dictation. Preview failure shows a warning while capture continues; explicit reconnect marks the gap. Provisional text never enters the insertion path.

Task 9 manual Windows check: choose **Live transcription test (no insertion)**, enable live words, prepare the actual microphone, and focus a disposable Notepad/VS Code/browser input. Hold the shortcut for 8–15 seconds and confirm provisional words appear before release while focus/input contents stay unchanged. Release retains audio and performs no automatic insertion in this mode. Test preview failure/reconnect while capturing, then cancel/discard and confirm no late text reappears. For the original Task 9 baseline, bypass cleanup in normal dictate mode and confirm canonical insertion, Finalizing status, clipboard restoration, and success hiding. Real provider requests occur with live preview enabled. See [Task 9 verification](scripts/task9-verification.md) for observed scope.

### Task 9 integration checks

Use the existing synthetic-microphone/debugger launch setup below. From `desktop/`, run:

```powershell
node scripts/task9-webview-check.mjs prepare
powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/task9-window-check.ps1
```

This local pass uses fixed live/final-STT fixtures, real synthetic microphone capture, both WebViews, native overlay commands, and a disposable Windows input. It checks Unicode, literal markup, long previews, failure/reconnect, processing cancellation, stale events, disabled-preview reset, native payload rejection, focus preservation, and unchanged input. It cancels before any canonical paste. The helper temporarily clicks its own disposable input to establish focus and restores the pointer afterward. Summaries print booleans/counts only; screenshots of synthetic content are saved under ignored `src-tauri/target/task9/`.

Restart the test app to remove fixture patches before opting into real streaming:

```powershell
node scripts/task9-webview-check.mjs prepare --live
powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/task9-window-check.ps1 -Live
```

The explicit live mode uploads the fixed synthetic speech through the native transport using the saved key. It verifies words before release, focus/no-edit behavior, retained original audio, discard, and startup cancellation. Preview failure/reconnect and delayed processing are covered by the local pass. Run `node scripts/task8-webview-check.mjs security` to confirm overlay command restrictions. Quit the test process before normal use; fake-device/debugger flags and provider patches must not persist.

Manual Windows checks:

1. Prepare the microphone, focus a disposable input, hold the shortcut and release. Confirm Listening then Processing, no focus change, canonical insertion, and overlay hiding. This normal flow can make existing provider requests.
2. Cause a transcription or destination failure. Confirm the warning persists and audio/text recovery remains available through the tray. Retry or discard; verify that the warning clears when resolved.
3. Cancel during recording/startup/finalization; confirm the panel hides and no late response brings it back. Confirm an unresolved clipboard restoration keeps recovery visible even after paste dispatch.
4. Check multiple monitors and Windows display scales; verify the panel stays within the selected monitor's work area and ignores pointer input. Multi-monitor placement was observed, but a full DPI matrix remains a follow-up.

### Local-only Task 8 integration fixture

Use the Task 6 synthetic WebView2 microphone/debugger launch setup below. With that separate development app running, run `node scripts/task8-webview-check.mjs prepare slow` from this directory. This helper verifies a Fake microphone, disables live streaming, captures the registered shortcut callback, and replaces final STT with a fixed local fixture in that test WebView only. It makes no provider requests and never retrieves or prints credentials.

Focus a **disposable blank external input** before running `node scripts/task8-webview-check.mjs press`. Inspect Listening, then run `node scripts/task8-webview-check.mjs release` to inspect Processing. `complete` releases the delayed fixture and dispatches a real native paste of fixed test text; `cancel` discards and suppresses the delayed result. Discard before another session. `prepare failure` injects a fixed final-STT failure; `retry` uses the success fixture with the retained original audio. `prepare success` completes normally. `status` prints states/booleans only; `security` verifies the overlay cannot invoke app credential-presence commands. Immediate status reads may precede completion of the queued native window update.

The read-only native observer is opt-in: `cargo test --lib --offline overlay::tests::windows_overlay_observation -- --ignored --exact --nocapture` in `src-tauri/`. It reports window handles, visibility, native styles, and geometry without changing focus. It needs the same Windows desktop/user context as the test app; sandboxed processes may not see those windows. Quit the synthetic app before normal use so fake-device/debugger flags and frontend fixture patches are removed. See [Task 8 verification](scripts/task8-verification.md).

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

### Opt-in Task 7 integration checks

Use the synthetic-microphone launch below, then run from `desktop/`:

```powershell
node scripts/task7-webview-check.mjs prepare
node scripts/task7-webview-check.mjs record --live
node scripts/task7-webview-check.mjs discard
node scripts/task7-webview-check.mjs interrupt --live
node scripts/task7-webview-check.mjs retry --live
node scripts/task7-webview-check.mjs discard
node scripts/task7-webview-check.mjs reconnect --live
node scripts/task7-webview-check.mjs discard
node scripts/task7-webview-check.mjs cancel --live --after-words
node scripts/task7-webview-check.mjs cancel --live
```

These helpers require a verified fake microphone. They replay shortcut events through the registered handler and print only fixed statuses, counters, durations and synthetic-phrase recognition booleans. The interrupt/reconnect checks terminate the real native connection and inject a fixed disconnect notification at the transport seam; they do not disconnect the physical network. See [Task 7 verification](scripts/task7-verification.md) for observed results and boundaries. Quit the synthetic app before launching normally without debugger/fake-device flags.

For configuration/account access without uploading audio, run the explicit opt-in probe from `src-tauri/`: `cargo test --lib --offline streaming::tests::saved_key_live_configuration_probe -- --ignored --exact`. It reads the saved credential only in Rust and returns fixed failures. Regular `npm test` and Rust tests use deterministic fakes/in-memory peers and make no API calls.

## Dictation session (Task 6)

Prepare the microphone, focus the intended external input, then hold the shortcut while speaking. Release sends the complete in-memory PCM16 mono WAV directly to OpenAI using the saved key, then inserts the selected final text at the captured destination: conservative cleanup when accepted, otherwise the exact canonical transcript. This mode uploads automatically on release; the optional live preview also streams audio while held and displays provisional words in the passive overlay. Task 11 adds optional cleanup and Copy original transcript. Segmentation remains deferred. Task 10 records combined single-segment checks and the remaining Windows verification gap.

The session has `idle`, `recording`, `finalizing`, `ready`, `inserted`, `failed`, and `discarded` states. Only one session is active. Successful canonical results are retained in memory when another dictation starts; unresolved failed audio must be retried or discarded first. A new hotkey press during finalization visibly explains that the session is busy. Capture failure, empty recordings, and microphone interruption remain recoverable or explicitly discardable. A disconnect retains partial audio for playback and an explicit Retry transcription instead of silently uploading it.

**Cancel and discard** works during recording and transcription. It stops capture, clears local audio/text, invalidates the destination, suppresses late responses, and immediately releases the local session lock. A sent native request still owns its upload buffers until it finishes; a new request encountering the native busy guard fails promptly with saved-audio retry guidance. Once native paste is dispatched, cancellation is disabled until the insertion result or the bounded uncertain-outcome timeout; paste cannot be undone by discarding.

Failed transcription keeps PCM/WAV/playback for **Retry transcription**. A usable canonical transcript releases audio and stays selectable until explicit discard or exit. If the focused input, available caret position, or pointer changes, insertion refuses and offers **Copy transcript**. A refusal confirmed before any paste attempt also permits retry by returning to the original input/caret and pointer position and pressing/releasing the shortcut. It retries insertion without another API request. Partial paste, unknown IPC outcomes, and clipboard restoration failures never permit automatic repeat insertion.

Copy transcript backs up supported clipboard formats. **Restore previous clipboard** is available afterward. If the clipboard cannot be backed up, **Replace clipboard with text** explicitly replaces it. Automatic paste restores its temporary clipboard only if no newer copy occurred. A successful paste and failed clipboard restore are reported separately; use Restore rather than inserting again. Sending paste keystrokes does not prove the destination accepted them. Target checks cannot prove that the user switched away and back or moved and restored a cursor between checks.

Audio is never written to disk. WAV bytes cross binary Tauri IPC; Rust reads the key directly from Credential Manager. No credential is returned to the UI. Uploads are limited to 25,000,000 bytes and successful responses to 1 MiB. Native HTTPS verifies certificates and disables redirects. Resolve/connect timeouts are 10 seconds each. Native send/response work shares a 60-second elapsed budget; remaining time is applied before response receipt and each body read, so a trickling response cannot hold the request lock forever. DNS/connect retain their separate bounds, so the budget is not an exact wall-clock maximum for all OS phases. Ordinary logs contain no credentials, audio, or dictated text. HTTP 401 does not distinguish invalid, expired, and revoked keys. App exit/crash loses pending audio and transcripts.

Manual Windows checks:

1. Prepare the microphone, focus a blank Notepad/VS Code/browser input, hold for 5–10 seconds, then release. Bypass cleanup to verify exact canonical insertion, or compare accepted cleanup with Copy original transcript. Confirm playback disappears, original text remains, and the clipboard is restored. Discard before another dictation.
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

Enter your OpenAI API key in the masked field and choose **Save key**. The field clears immediately after submission. The app stores a generic credential at `app.byokdictation.hotkeyprobe/openai-api-key` in Windows Credential Manager for the current Windows user on this machine. The saved key is never returned to the UI; the UI requests only its presence. **Remove key** deletes the credential, and saving another key replaces it.

Saving does not require internet access. **Check connection** explicitly reads the saved credential in Rust and sends an authenticated `GET https://api.openai.com/v1/models` using Windows WinHTTP. Certificate verification is enabled, redirects are disabled, and resolve/connect/send/receive timeouts are each 10 seconds. No recording or transcript is sent. There are no background validation requests, and a failed request keeps the saved key. Validation uses fixed error codes; headers, secrets, and provider response bodies are not displayed or logged. Temporary Rust secret buffers are wiped on drop; this does not guarantee erasure of every WebView/IPC/OS memory copy.

The request follows the [OpenAI models API](https://developers.openai.com/api/reference/resources/models/methods/list). Success establishes access to the models endpoint, while transcription model access remains Task 5. A permission error may mean a restricted key cannot list models; it does not prove the key is invalid.

Manual Windows check:

1. Enter a key locally in the app and choose **Save key**. Confirm the field clears and the saved-key status appears.
2. Choose **Check connection**. Confirm successful validation, or record the displayed error without recording the key itself.
3. Use the tray menu's **Quit** action; closing the window only hides it. Run `npm run tauri dev` again. Confirm the key is still saved while the input remains empty, and validate without re-entering it.
4. Temporarily disconnect the network and validate again. Confirm a network/timeout error appears and the key is still saved. Restore the connection and retry.
5. Choose **Remove key**. Confirm the status says no key is saved and Validate is disabled. Save the desired key again if continuing with the transcription probe.
6. Confirm the app's event list and console contain no entered key and that no app-owned plaintext credential/settings file was created. The credential may be inspected or removed in Windows Credential Manager under Windows Credentials.

Record the observed results in `../DECISIONS.md`. Deterministic input/error tests run with `cargo test --lib` from `src-tauri/`. The native storage probe is opt-in: `cargo test --lib credentials::tests::windows_credential_restart_probe -- --ignored --exact`. It creates a unique disposable fixture credential, reads it from a fresh process, replaces it, deletes it, and checks removal; it does not read or replace the app's key. The separate opt-in network check is `cargo test --lib openai::tests::openai_rejects_invalid_fixture_key -- --ignored --exact`; it sends a deliberately invalid fixture key to OpenAI and reads no saved credential.

## Microphone capture checks

The original Task 3 recording/playback, permission denial, clearing, and disconnect/reconnect checks are recorded in `../DECISIONS.md`. Task 6 now automatically transcribes on release. A successful transcript releases playback/audio; playback remains available after transcription failure or microphone interruption.

Choose the input device in Settings or leave System default microphone selected. Access is checked automatically; use Allow microphone only to recover blocked access. The input meter should move while speaking. Capture uses mono Float32 PCM in memory and reports duration, sample rate, device, and AudioWorklet diagnostics for empty recordings. A stopped capture is encoded as in-memory PCM16 WAV.

For current checks, follow the Task 6 matrix above. Confirm the live meter, successful transcription/insertion, and audio release. On microphone disconnect, confirm partial audio remains for playback and explicit Retry transcription; discard it, reconnect/refresh, and prepare again before another session. Permission errors should remain visible and the empty/failed session must be discardable. Quitting releases pending audio; no microphone recording is saved to disk.

## Text insertion probe

Put the caret in Notepad, VS Code, or a browser text field, then press and release the shortcut. On key-down the probe captures the foreground and focused window, caret rectangle when Windows provides one, and pointer position. After key-up it waits for modifier keys to be released, checks the target again, temporarily replaces the clipboard, sends Ctrl+V, and restores the saved formats if no newer copy occurred. Keep the pointer still during a normal insertion test. The probe refuses automatic paste when focus or the pointer/caret changes, a clipboard format cannot be backed up, or a Windows API call fails.

Before this check, choose **Text insertion test** under **Settings → Developer diagnostics → Shortcut test mode**.

**Copy test text** saves supported clipboard formats, then puts the fixed string on the clipboard. **Restore previous clipboard** becomes available after that Copy action; use it after pasting the test string. This includes rich clipboard formats backed by movable global memory. GDI/owner-rendered formats and clipboard content over 64 MiB are not supported by this probe; the safe Copy action leaves them untouched and explains why. **Copy without backup** explicitly replaces an unsupported clipboard, and Restore remains unavailable. Automatic paste normally restores its own temporary clipboard without needing the Restore button; the button also becomes available if that restoration fails.

Test the following cases and record the observed result in `../DECISIONS.md`:

1. Plain-text clipboard, then insert into Notepad, VS Code, and a Chrome or Edge input. Confirm both the pasted string and clipboard restoration.
2. Switch apps before releasing, move the pointer or caret before releasing, and close the target before releasing. Confirm no automatic paste and use Copy.
3. Copy different text immediately after release. Confirm the probe does not overwrite that newer copy.

The probe reports that paste keystrokes were sent, not that the destination accepted them; confirm insertion in the target. It can detect the current target and caret position, but cannot prove that an app was switched away and back during one hold or that an input accepted the paste. Closing the probe window hides it; use the tray menu to show it or quit.

For a repeatable Windows text-box check while the probe is running, use `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/insertion-smoke.ps1`. It opens a temporary focused input, sends real Windows key events, and reports inserted text and whether clipboard text matches its value before the test. Notepad, VS Code, and browser checks remain separate manual checks.

To check that a newer clipboard copy is preserved, run `powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/newer-copy-smoke.ps1` while the probe is open. The script replaces the clipboard with disposable text. Within 15 seconds, focus a blank Notepad document and press Ctrl+Alt+F8. The script watches for the probe's temporary clipboard text, copies a newer marker, and reports whether the marker survives the probe's restore attempt.

## Single-segment integration (Task 10)

Normal **Dictate and insert** combines provisional overlay words with complete-original-audio final transcription and guarded canonical insertion. The overlay says **Finalizing** on release and hides immediately after successful paste/clipboard restoration; **Completed** and the retained canonical result remain in the main window. Live probe mode intentionally retains audio and does not paste.

The combined regression and optional Windows helper are documented in [Task 10 verification](scripts/task10-verification.md). The new combined native/live check remains unverified because desktop automation timed out before the test started. Earlier platform checks and regular deterministic tests pass. With a fresh synthetic test app, run `node scripts/task10-webview-check.mjs prepare` (add `--live` only to opt into provider requests), focus the disposable input from `task10-window-check.ps1`, and create the ignored `src-tauri/target/task10/start.txt` trigger. The helper adds an observation delay and is not a latency benchmark. Quit the synthetic app before normal use.

## Conservative cleanup (Task 11)

**Light cleanup** is enabled by default. Disable it before recording to insert the canonical transcript directly; the choice is fixed for the session. After canonical transcription, the app sends that text directly to `gpt-6-luna` with minimal-edit instructions. Accepted cleanup supplies insertion and **Copy cleaned**. Failed, incomplete or rejected cleanup uses canonical text and shows a recovery notice; it does not block insertion. The original transcript stays available through **Copy original** until explicit discard or exit.

The guard permits only conservative edits and rejects changed lexical content/order or protected values. It may fall back on text that could have been acceptably cleaned. Neither the prompt nor the guard proves meaning preservation; the original and bypass remain available. No foreground application content is collected. Cleanup uses native saved-key access, fixed HTTPS endpoints, bounded payloads and `store: false`; dictated text is not written to app logs/files. Provider-side retention is governed by the account/provider policy.

See [Task 11 verification](scripts/task11-verification.md) for deterministic/API checks and the manual comparison/cancellation checklist. Existing local-only Task 8–10 helpers explicitly bypass cleanup so their fixtures do not cause new provider requests.

## Failure recovery (Task 12)

Failed or malformed canonical transcription retains the original audio for **Retry transcription**. Cleanup failure uses the exact canonical fallback. Insertion failure retains original, accepted cleaned and provisional text; only a confirmed refusal before paste permits insertion retry without another provider request. An uncertain or partial paste requires checking the destination before explicit Copy/paste.

**Copy live words** presents the exact available snapshot for explicit confirmation, even if live preview is still finishing. It warns that words may be incomplete, inaccurate or contain gaps and are not the final transcript. It does not replace canonical text. Processing bypass also requires this confirmation and stops waiting before copying. Copy uses the same clipboard backup/Restore behavior; its no-backup counterpart explicitly replaces unsupported clipboard content.

Cancellation clears local session sources, immediately unlocks the local session, and suppresses late results. Native request guards can briefly refuse a new request until their bounded send/response work finishes; the app retains the new recording for retry and reports that condition. Paste cannot be cancelled after dispatch; an insertion wait timeout exposes an uncertain outcome for manual recovery. Exit or crash loses pending audio, transcripts and in-memory clipboard backups.

See [Task 12 verification](scripts/task12-verification.md) for the recovery matrix and final checks. Milestone 2 implementation is complete; the full new combined Windows manual validation remains pending as recorded in Task 10.
