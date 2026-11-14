# Progress log (archived)

Session-by-session progress notes from September to October 2026, moved out of the [decision log](../DECISIONS.md). They are a historical record: test counts, file names and pending items describe the project at the time each note was written.

## Windows build, tasks 0–12


### 2026-09-21 — Task 0 decisions recorded

- Confirmed Windows-only release scope and memory-only audio buffering with the user.
- Updated TASKS.md to reflect those choices across capture, transcription, recovery, and release checks.
- Recorded the previously agreed hotkey preference; platform reliability remains unverified.
- Verification: reread the task list and log for consistent scope and recovery guarantees. No implementation or capability probes have run.
- Next: choose the initial stack and identify the Windows test environment, then run task 1.

### 2026-09-22 — Initial stack chosen (Task 0)

- The user chose Tauri + TypeScript + Vite after comparing Electron and Tauri for hold-to-talk and a later macOS port.
- Local inspection found Windows x64, version 25H2/build 26200, Node 22.14.0, npm 10.9.2, Rust/Cargo, Visual Studio 2022 Professional, Notepad, and VS Code. This is environment inventory, not a capability probe.
- Microphone availability remains unverified because audio-device enumeration returned Access denied. The C++ build workload and a browser input target also remain unverified.
- Next: confirm the Windows test devices and run Task 1's real key-down/key-up probe in Notepad and VS Code. Keep the toggle fallback until that probe establishes reliability.

### 2026-09-22 — Task 0 test environment confirmed

- Windows audio-endpoint inventory reports **Mic In (2- Elgato Wave:3)** with status OK. Chrome and Edge application paths are registered; Notepad and VS Code are also available.
- Task 0's scope, stack, verification access, and memory-only recovery guarantee are now explicit. Marked the remaining Task 0 device item complete in TASKS.md.
- Verification is an environment inventory only. Microphone capture, key-up reliability, and text insertion remain untested and are assigned to their capability probes.
- Next: Task 1, the real Windows global keybinding probe in Notepad and VS Code.

### 2026-09-22 — Task 1 probe implemented; live input check pending

- Scaffolded a Tauri + TypeScript + Vite app in `desktop/` with a tray menu, configurable global shortcut, and timestamped key-down, key-up, and derived toggle log.
- Verification: `npm run build` and `cargo fmt --check` passed; `npm run tauri dev` compiled and launched a responding Windows window titled “BYOK Dictation — Hotkey Probe”.
- The Windows Computer Use helper exited with a sandbox setup error on both attempts, so automated key presses in Notepad and VS Code could not run. Asked the user for the live focus test; shortcut registration availability and release reliability remain unverified.
- Task 1 stays in progress until the observed key-down/key-up results establish whether hold-to-talk or toggle is the initial interaction.
### 2026-09-22 — Task 1 live hold test

- User-reported live result after the requested Notepad and VS Code focus test: Ctrl+Alt+F8 produced key-down at 21:59:58.053Z and key-up at 21:59:58.154Z, then key-down at 21:59:58.780Z and key-up at 21:59:58.881Z. The user confirmed it worked.
- The initial probe also displayed a synthetic toggle transition on each press. Removed that diagnostic and kept hold state driven directly by Pressed and Released events in `desktop/src/main.ts`.
- Post-change verification: `npm run build` and `cargo fmt --check` passed; `npm run tauri dev` relaunched a responding Windows client. The revised UI was not independently inspected because the Computer Use helper remains unavailable.
- Shortcut rebinding remains to be checked before marking all of Task 1 complete.
### 2026-09-22 — Task 1 verified complete

- User-reported rebind check in Notepad: after applying Ctrl+Alt+F7, F7 produced a key-down/key-up pair and the previous Ctrl+Alt+F8 binding stopped logging.
- Combined with the two earlier press/release pairs reported after the Notepad and VS Code focus test, this verifies the chosen shortcut, release delivery, and live rebinding on this Windows machine.
- Task 1 is complete. Hold-to-talk is the initial behavior; recording itself remains for Task 3.

### 2026-09-22 — Task 2 insertion probe implemented; live target checks pending

- Added a Windows native command path to capture the foreground/focused window on key-down, compare it on key-up, and send a fixed string through clipboard plus simulated paste. Pointer and available caret coordinates are compared; changed or uncertain targets retain a Copy fallback.
- Plain-text clipboard contents are backed up and restored only if the clipboard sequence has not changed. Rich or non-text clipboard formats use Copy instead. A failed restoration retains the previous plain-text clipboard in memory for an explicit Restore action.
- Added modifier-release and clipboard-busy timeouts, visible failure messages, and manual test instructions in `desktop/README.md`. Paste keystroke acceptance does not establish that the target accepted the text.
- Verification: TypeScript/Vite and Rust builds passed. The sandboxed app launch failed with Access denied; the unsandboxed app launched. A temporary WinForms input accepted the fixed string through the actual global shortcut and Ctrl+V path. A follow-up check exposed an incorrect clipboard sequence sample taken before `CloseClipboard`; this was corrected. The repeatable Windows smoke script is in `desktop/scripts/insertion-smoke.ps1`. Notepad, VS Code, browser, target-change cases, and nonempty clipboard restoration still require observed Windows tests before Task 2 can be marked complete.

### 2026-09-22 — Task 2 Copy/Restore behavior corrected

- User found that **Copy test text** replaced the clipboard without creating a backup, so **Restore previous clipboard** failed. Copy now backs up a plain-text clipboard first and enables Restore; the button is disabled when no backup exists.
- Rich and non-text clipboard formats remain untouched by the safe Copy action. A separately labeled **Copy without backup** action allows an explicit replacement when the user chooses it.
- Verification: `npm run build`, `cargo check --offline`, and `cargo fmt --check` passed. The new Copy/Restore click sequence still needs a live user check.

### 2026-09-22 — Task 2 rich clipboard backup expanded

- User's copied item included additional Windows clipboard formats, so safe Copy still refused it. The snapshot now preserves each supported movable-memory format as bytes, including common registered rich-text formats, and restores the original format IDs and data. Unsupported GDI/owner-rendered or very large formats still require an explicit Copy without backup.
- Verification: Rust compilation passed. The user subsequently reported that the current hotkey and clipboard flow works. The specific Notepad, VS Code, browser, and target-change matrix was not recorded, so Task 2 remains in progress.

### 2026-09-22 — Task 2 Notepad and VS Code target checks

- A blank Notepad document received exactly `BYOK dictation insertion probe` after Ctrl+Alt+F8. A disposable VS Code Untitled editor received the same string through the shortcut. Both results were visibly checked in their target editors; no source file was edited.
- The user subsequently reported that browser paste works. The manual browser result completes the Notepad, VS Code, and browser input check.
- The user confirmed that no text appeared in either target after switching targets while holding the shortcut. The probe displayed the warning, and the Copy fallback worked. The user then confirmed that moving the caret and closing the target before release each produced no paste and a warning. This completes the changed-destination recovery checks. The user also confirmed the modifier timeout works. The newer-copy check remains unverified, so Task 2 is still in progress.

### 2026-09-22 — Task 2 text-insertion probe complete

- Added `desktop/scripts/newer-copy-smoke.ps1` to copy a newer marker while the probe's temporary clipboard text is present. The user ran it and reported `PASS: The newer clipboard copy was preserved`.
- All Task 2 checks are now complete: fixed-text insertion in Notepad, VS Code, and a browser input; clipboard backup and restore; no paste with a warning after target switching, caret movement, target closure, or modifier timeout; and a working Copy fallback. The scripted newer-copy check confirmed the probe preserved a copy made during insertion.

### 2026-09-23 — Task 3 microphone probe implemented; manual verification pending

- Wired the default hold-to-talk action to start and stop microphone capture. Kept the text insertion probe available as a selectable hotkey action.
- Added microphone enumeration and selection, visible permission/device errors, AudioWorklet-based mono Float32 PCM buffering, duration/sample-rate/channel/device metadata, in-memory WAV playback, explicit audio clearing, and partial-buffer retention on microphone disconnect.
- Updated `desktop/README.md` with Windows checks for a 5–10 second recording, playback, clearing, permission denial, and disconnect/reconnect.
- Verification: `npm run build` passed. The first live capture attempt returned zero PCM frames; Task 3 remains open until a recording is captured, inspected, and removed on Windows.

### 2026-09-23 — First live microphone attempt returned zero frames

- User reported `Duration: 0.00 s` with a 48,000 Hz mono rate and the Elgato Wave:3 selected. The device metadata appeared, but the capture path had not recorded PCM frames.
- Added a **Prepare microphone** step before push-to-talk and diagnostics for AudioContext state, AudioWorklet callbacks/input channels, and microphone track state. Empty captures now show those diagnostics in the UI.
- Added a live RMS input meter plus explicit **Play captured audio** and **Stop playback** controls so a non-empty capture can be verified immediately without saving it.
- Verification: `npm run build` passed after the change, and the updated Tauri dev app was relaunched. The zero-frame case needs another live check with microphone access prepared first.

### 2026-09-23 — Task 3 Windows verification complete

- User confirmed successful microphone recording and playback, clearing the recording, visible handling when microphone permission is denied, and partial-audio retention plus recovery after disconnecting and reconnecting the microphone.
- Task 3 is complete on Windows.

### 2026-10-01 — Task 4 implemented and verified complete on Windows

- Added a masked API-key field with separate Save, Validate, and Remove actions. The field clears immediately on submission. The UI holds saved-key presence only, never retrieves the saved secret, and maps fixed backend error codes to local messages without logging raw errors.
- Added native Windows Credential Manager storage with local-machine persistence for the current Windows user. Rust reads the secret for API validation, wipes owned secret buffers, and returns no raw key through the registered commands. There is no app-owned plaintext credential file.
- Added explicit native HTTPS validation against OpenAI's models endpoint, with certificate checks, disabled redirects, per-phase timeouts, and separate handling for authentication, permissions, rate limits, provider failures, network errors, and TLS failures. Failed validation retains the saved credential; validation sends no audio.
- Verification: `npm run build`, `cargo fmt --check`, and the two deterministic Rust tests passed. The opt-in Windows probe stored a disposable fixture, retrieved it in a fresh process, replaced it, removed it, and confirmed absence. The separate opt-in real OpenAI request with an invalid fixture key returned the expected authentication failure. Both probes read no app credential and the storage probe used a unique target.
- `npm run tauri dev` compiled and started the updated app; Windows Computer Use found the window titled **BYOK Dictation — Capability Probes**. UI state inspection timed out waiting for app access, so control behavior has not been independently inspected.
- The user entered and saved their key locally, then reported **OpenAI accepted the saved key. Transcription model access will be checked by the transcription probe.** This confirms the live entry/storage/validation flow.
- Stopped the development app and relaunched it. Without re-entering the key, the user confirmed **Yes, saved key detected and validation succeeds**. Combined with the native storage/replacement/removal probe and source checks for secret logging/plaintext files, this completes Task 4. The app remains running with the user's key saved securely. Next: Task 5, the in-memory file-transcription API probe.

### 2026-10-01 — Task 5 implemented; spoken-audio verification pending

- Added explicit Transcribe / Retry / Discard controls and a selectable canonical-transcript view. Complete PCM16 mono WAV recordings stay in memory and cross binary Tauri IPC to Rust. Native WinHTTP uploads directly to OpenAI with the key read internally from Windows Credential Manager. No audio file is written or secret returned to the UI.
- Final STT has a small interface with deterministic fakes. Failed, malformed, or empty responses retain retry audio. A usable transcript releases PCM, WAV, and playback resources while retaining canonical text until discard. Discard clears local results and suppresses late responses; an already-sent request finishes before another recording is allowed, releasing native upload buffers when it returns.
- Verification: frontend build, 5 Node tests, 7 deterministic Rust tests, formatting, and native debug build passed. Checks cover WAV/multipart formatting, Unicode preservation, input validation, same-audio retry, duplicate requests, discard before upload, late success/failure suppression, and audio release on success.
- The opt-in invalid-key transcription request initially failed to connect inside the sandbox. Outside the network sandbox it reached OpenAI and returned the expected authentication failure. It sent only synthetic silence and an invalid fixture key, never the saved credential. Successful account/model access remains pending.
- Initial launch attempts collided with an existing Vite server and left a probe process with no window locking the executable after the server stopped. After the user reported the app could not open, the verified stale probe process was terminated and the app/server restarted together. Process inspection confirmed a nonzero window handle titled BYOK Dictation — Capability Probes; the local server serves the transcription controls.
- The updated app is running. Task 5 remains in progress pending spoken-audio transcription and Windows retry/discard checks in desktop/README.md. Automatic insertion remains Task 6.

### 2026-10-01 — Task 5 live transcription succeeds

- The user reported that the transcript appears after the requested live recording/transcription check. This verifies successful recording upload, the request format and account/model access with the saved key, and transcript display.
- Updated the corresponding Task 5 checklist items. Audio release after success, failed-request retry, and explicit discard still require observed Windows checks; Task 5 remains in progress. Transcript accuracy beyond appearing was not separately reported.

### 2026-10-01 — Task 5 completion criteria verified

- The user confirmed that the retry flow works after the requested network-failure/reconnect/retry check. Together with the earlier successful transcript display, this satisfies Task 5's completion criteria: a real recording transcribes with the saved key and a failed request retries using retained audio.
- Marked Task 5 complete and updated the README. Audio release, explicit discard, duplicate-request prevention, and late-response suppression have passing deterministic coverage; this report does not separately establish live release/discard behavior. Those manual checks remain useful in the later lifecycle/recovery audits.
- Next: Task 6, session lifecycle and transcript insertion. Connect hotkey release to whole-recording canonical transcription and safe insertion, with cancellation, late-response handling, duplicate-insertion prevention, and Copy/retry recovery.

### 2026-10-01 — API-key leak audit and memory handling hardening

- Compared the app's saved key locally, without printing it, against repository files, app build outputs, this app's WebView/profile data, and all local Git objects. No matching key exposures were found. The only initial token-pattern finding was the deliberately invalid transcription-test fixture; exact saved-key matching remains independent of fixture allowances.
- Reviewed current key entry, credential commands, logging, native HTTPS, and the developing transcription path. No raw-key getter, frontend secret persistence, credential in URLs, key logging, or provider failure-body forwarding was found.
- Hardened input clearing before IPC and made UI error mapping accept only explicitly owned error-code entries. Fixed header construction so appending Content-Type cannot reallocate a buffer already containing a secret and leave an unwiped copy behind.
- Added root Git ignores for local environment/private-key files and a repeatable, redacted local audit. KEY_SECURITY.md records the command, scope, and memory/Windows-account limitations. Simultaneous transcription work was preserved.
- Verification: frontend build passed, all 8 deterministic Rust tests passed, 3 UI privacy regression tests passed, and 4 scanner/redaction regression tests passed. Real API checks remained opt-in; this audit made no API requests and did not export or modify the saved credential.
- Final saved-key comparison: 441 files/build outputs and 242 local Git objects checked with no matching exposures. Read-only Windows shared access allowed the running app's WebView caches to be included; no selected files remained unreadable.

### October 1–2, 2026 — Task 6 implemented and verified with synthetic microphone input

- Added explicit session lifecycle states, key-down destination ownership, automatic whole-recording transcription/insertion on release, cancellation, native-work locking, late-response suppression, and canonical transcript retention. Native insertion accepts arbitrary validated text, rejects stale session tokens, and latches a paste attempt. Copy supports clipboard backup/Restore and explicit replacement without backup. A failed clipboard restoration cannot cause another automatic paste.
- Added opt-in synthetic speech and development WebView2 integration helpers. Windows System.Speech generated a fixed local fixture; WebView2's fake audio input fed the existing microphone capture path. No virtual audio driver, external TTS service, or new runtime audio dependency was needed. The fixture is synthetic and lives under ignored build output; real recordings remain memory-only.
- Real OpenAI transcription and native paste succeeded in disposable Notepad and VS Code inputs. The canonical 92-character phrase was visually verified in both. A separate real Windows shortcut retried a refused insertion successfully without retranscription. Native Unicode/newline/URL/filename/identifier fixtures, duplicate refusal, changed-target refusal, and Copy/Restore recovery passed observed checks. Recording cancellation cleared audio/text and remained usable after the final UI changes.
- Verification scope: long holds were replayed through the actual registered shortcut handler in the development debugger. Capture, AudioWorklet processing, WAV encoding, binary IPC, native provider requests, target checks, paste, and clipboard operations were real. Physical microphone/full-duration key holds and a new browser-input check were not repeated; their earlier platform probes remain documented. A Vite-reload-interrupted run was excluded and rerun.
- Evidence and reproducible setup: docs/verification/task6-verification.md and desktop/README.md. Regular tests use fakes; live synthetic requests are explicit opt-in and read the saved key only inside Rust. Next: Task 7, live-transcription probe.
- Final local checks passed: 14 deterministic Node session tests, 12 deterministic Rust tests (4 opt-in tests skipped), TypeScript/Vite build, Rust formatting, 3 existing UI privacy tests, and 4 leak-scanner regression tests. The pattern-only leak scan found no matching exposures in 77 files/build outputs and 250 Git objects; this final scan did not retrieve the saved key.

### 2026-10-02 — Task 7 implemented and verified with real streaming and synthetic microphone input

- Added native authenticated WebSocket streaming, independent 24 kHz PCM16 preview conversion, a provisional transcript/debug latency view, explicit reconnect with a marked gap, bounded queues/text, cancellation and late-event suppression. Original microphone PCM remains independent; final transcription/insertion never consumes live text. Added a dedicated live probe action that retains audio on release and skips insertion; normal dictate mode keeps its existing finalization behavior.
- The explicit saved-key configuration probe passed against OpenAI without uploading audio. An eight-second synthetic-microphone check delivered 20 real transcript deltas before release and one completion; first visible text was 1,727 ms after capture started. Later synthetic observations were 1,004–1,100 ms. These observations are not physical-microphone acceptance targets.
- Interruption recovery retained the complete 9.51-second original recording. Explicit real final transcription succeeded, returned recognized canonical text, released audio and left the probe result ready for Copy. Reconnect opened a second real provider connection, delivered further words/completion and marked the preview gap. Cancellation during startup and after eight live deltas cleared audio/text; another session remained usable.
- Verification scope: synthetic speech and shortcut-handler replay; real capture/AudioWorklet, conversion, IPC, TLS/provider connections and final transcription. Disconnect integration uses real socket termination plus a fixed injected notification; deterministic native peers separately test unexpected socket closure. Physical microphone/network-outage checks and new target-app paste verification remain documented manual follow-ups. No recordings or transcripts were saved by the app/helpers, and credentials remained native.
- Final checks: 29 deterministic Node checks, 18 deterministic Rust checks (five opt-in helpers skipped), TypeScript/Vite build, native debug build, Rust formatting, four leak-scanner regression checks and Git whitespace check passed. Source/UI review confirmed that live text has its own view, failed previews preserve original audio, and the probe action does not capture a paste target.
- The saved-key/app-data audit initially could not read the running WebView cookie database. Closed only the task's synthetic app and reran it: all 486 selected files/build outputs and 271 local Git objects were readable, with no matching key exposures. This audit printed no key values and made no API requests.
- Evidence and repeatable setup: docs/verification/task7-verification.md and desktop/README.md. The synthetic app was stopped before restoring the normal microphone/debugger configuration. Task 7 is complete within the documented verification scope. Next: Task 8, minimal floating overlay.

### 2026-10-03 — Physical microphone and network-outage follow-ups

- The user reports that the physical microphone test works perfectly. Recorded this user-observed result in docs/verification/task7-verification.md; no numerical latency measurement was supplied.
- The user also reports that the network-outage check works. Recorded this as a user-observed pass of the recording-retention and transcription-recovery check. No separate result was supplied for the optional live preview reconnect during capture.

### 2026-10-03 — Task 8 status overlay implemented and verified

- Added the passive floating window, independent frontend, fixed status copy, native nonactivating show/hide, monitor work-area placement, and restricted overlay IPC. Destination capture precedes display; main-window session/audio ownership and recovery remain intact.
- Real Windows observations preserved Notepad focus during Listening, delayed Processing, failure recovery, and hiding. A local fixed-STT failure retained synthetic audio; retry inserted fixed canonical text in Notepad, restored the clipboard, released audio, and hid the overlay. Cancellation suppressed the delayed result. Two-monitor placement and VS Code window focus were observed; no new VS Code editor or browser insertion pass is claimed.
- Windows browser automation stopped because its URL-policy check could not determine the browser URL. This did not block the verified Notepad overlay completion criterion. The synthetic app and sandboxed task-launch attempts were stopped; no API calls or credentials were changed.
- Final checks: 34 deterministic frontend tests and 20 deterministic native tests passed (six opt-in helpers skipped), alongside frontend/native builds, formatting, helper syntax, and whitespace checks. The pattern-only leak audit scanned 96 files/build outputs and 308 Git objects with no matching exposures. Ownership-generation hardening was checked deterministically after the UI run.
- Evidence and repeatable setup: docs/verification/task8-verification.md and desktop/README.md. Task 8 is complete within that documented scope. Next: Task 9, connect provisional live transcript deltas to the overlay.

### 2026-10-03 — Task 9 live overlay implemented and verified

- Connected the existing live preview to the passive overlay, with bounded plain-text tails, Provisional labels, connecting/listening/processing feedback, preview-failure and reconnect-gap warnings, and content-based serialized/coalesced updates. Hidden snapshots/events clear preview text and suppress stale updates. No provisional text enters canonical transcription or insertion.
- Local two-WebView and native Windows checks covered Unicode/literal markup, long-text layout, failure/reconnect, retained original audio, cancellation/late responses, delayed finalization, preview-disabled reset, payload rejection, and overlay command restrictions. A disposable native input stayed foreground and unchanged across 28 visible-overlay samples in the final local pass.
- A separate real native streaming run uploaded only the existing fixed synthetic speech. Provisional words appeared before release; release retained original audio without canonical text/paste in live probe mode. Discard and startup cancellation cleared text/audio. The disposable input stayed foreground and unchanged across 34 visible-overlay samples. Screenshots were reviewed; physical-device/key-hold/network and fresh Notepad/VS Code/browser checks are not claimed.
- Verification: 40 frontend and 20 native tests passed (six opt-in native helpers skipped), alongside frontend/native builds, formatting, helper syntax, privacy-scanner regressions, pattern-only leak audit and whitespace checks. Fixtures/debug flags remain process-local; task test processes are stopped afterward. Credentials were neither changed nor returned to the UI.
- Evidence and repeatable setup: docs/verification/task9-verification.md and desktop/README.md. Task 9 is complete within that scope. Next: Task 10, single-segment integration and the complete combined-flow verification.

### 2026-10-03 — Task 9 user manual pass and overlay UX feedback

- The user reports that the manual test is complete and works. Individual device/application, latency, and recovery subchecks were not separately specified; the verification note records the report without expanding its scope.
- The overlay remained after transcription. The user expected automatic disappearance or a dismiss/paste action and explicitly requested no behavior change now. The live probe intentionally retains a Ready session and skips destination capture/automatic insertion, while successful normal dictation hides after canonical paste and clipboard restoration. The passive overlay currently sends recovery actions to the main probe.
- Preserve this feedback for the combined experience: session retention and overlay dismissal can be separate, with convenient recovery/paste access. No UI or lifecycle code was changed for this report.

### 2026-10-03 — Task 10 integration checked; combined live verification pending

- Reviewed the existing normal dictate flow: capture destination before passive overlay display, store original samples independently of preview conversion, flush the worklet and transcribe one complete WAV on release, then insert canonical text only. Added explicit Finalizing/Completed feedback; successful insertion/restoration immediately hides the overlay and retains text until discard.
- A combined deterministic regression verifies byte-identical original-audio retry, unchanged session/destination ownership, unfinished-preview independence, canonical-only insertion, release/hide on success and late-preview suppression. 41 frontend tests, 20 native tests (six opt-in helpers skipped), frontend/native builds, formatting and helper syntax passed.
- Added repeatable synthetic combined-flow and native observer helpers. The desktop automation call hung before the observer trigger; no combined paste/API run occurred. This task's real-flow criterion remains pending, with exact limits in docs/verification/task10-verification.md. Continue Milestone 2 implementation without claiming a new platform pass; retain that gap for the final milestone report.

### 2026-10-03 — Task 11 conservative cleanup implemented

- Added a native CleanupModel/Responses provider using exactly gpt-5.6-luna, store:false, none reasoning, instructions separated from canonical user data and bounded complete assistant-text responses. Reused native saved credential/TLS/fixed-host/no-redirect handling; no new dependencies or ordinary content logs/files.
- Minimal cleanup permits conservative formatting and clear uh/um/erm disfluencies. The lexical guard rejects substantive word/order changes and altered protected numeric/technical/symbol/emoji tokens. Review found and fixed leading-dot values/files and operator/emoji gaps. It intentionally rejects some harmless edits; punctuation meaning is not formally guaranteed. Bypass and exact canonical recovery remain essential.
- Session cleanup is cancellable before paste, keeps native-work locking until completion and stores a separate cleaned result. Cleanup failure uses canonical text with a fixed nonfatal notice. Insertion retry makes no additional STT/cleanup request. Copy original transcript remains available until explicit discard; success still hides the passive overlay. Local-only prior helpers bypass cleanup.
- Verification: 47 frontend tests/build and 25 native tests passed (seven opt-in helpers skipped); final cleanup guard tests, native build/format, privacy scanner regressions and pattern-only audit passed. The real saved-key synthetic probe succeeded outside the sandbox, removing a filler and changing formatting while preserving substantive words (fixed boolean output only). Full combined Windows UI verification remains pending from Task 10; this is not an observed physical-microphone/paste pass.
- Evidence and manual checklist: docs/verification/task11-verification.md. Next: Task 12 failure recovery audit; retain existing live-UI gap in the milestone report.

### 2026-10-04 — Task 12 recovery audit and GPT-6 Luna update

- Added a combined recovery matrix covering live/final/cleanup/insertion failures, byte-identical audio retry, cancellation/late responses, repeated paste attempts and busy-session rejection. Canonical and cleaned text remain separate from provisional words. Explicit Copy provisional live text captures a settled current-session snapshot with an incompleteness/gap warning and the existing clipboard backup behavior.
- The audit found that canonical NUL text could release audio before native Copy/paste rejected it. Native parsing and the frontend success boundary now reject malformed text before releasing retry audio. Explicit discard clears all retained sources and stale callbacks cannot restore them; native request locks last until outstanding work completes. A paste already dispatched cannot be cancelled or automatically repeated after an uncertain result.
- At the user's request, cleanup now uses exactly gpt-6-luna with the existing Responses endpoint, none reasoning, prompt/data separation and preservation guard. A real saved-key synthetic probe succeeded in 2.65 seconds with fixed boolean evidence of filler removal and substantive-word preservation. Historical Task 11 gpt-5.6-luna evidence remains dated and unchanged.
- Final verification: 124 frontend checks and 25 native tests passed (seven opt-in helpers skipped), plus frontend/native builds and formatting. Four scanner regression tests and the saved-key/app-data audit passed: 565 selected files/build outputs and 399 Git objects, without printing/exporting the key. The privacy audit preceded the final model-only rebuild.
- Evidence and recovery/manual checklist: docs/verification/task12-verification.md. Milestone 2 implementation is complete with separate task commits; the full combined Windows manual validation remains pending after Task 10's automation timeout before its trigger. No Milestone 3 work is included. Exit/crash recovery remains outside this MVP.

### 2026-10-04 — UX checkpoint implementation and verification boundary

- Replaced the probe-first layout with a compact Windows utility surface, shortcut display, readiness/setup feedback, a native modal Settings dialog, contextual live/recovery sections, current original transcript inspection, and in-memory earlier-result recovery. API-key status exposes only presence/busy events, retains fixed error handling and immediate secret-field clearing, and locks credential controls during active dictation.
- Renamed product/window/tray labels and overlay recovery copy to Dictation. The main window is 600 × 640 with a 380 × 430 minimum; layout supports narrow windows. Keyboard focus, native dialog focus containment, reduced-motion handling, and accessible status labels are implemented. The passive overlay still has its existing nonactivating behavior and provisional label.
- Surface implementation was coordinated with the separate recording/session changes for automatic microphone readiness, settings persistence, recorded shortcuts, temporary Escape cancellation, and repeated successful sessions with retained originals. Existing probe IDs remain available in diagnostics for development verification.
- Verification: all 132 deterministic frontend tests and the TypeScript/Vite production build passed. The native build and 25 native tests passed with seven opt-in tests ignored; the initial linker temporary-file failure was resolved using process-local TEMP/TMP inside the workspace. Existing overlay/key-privacy checks and source DOM compatibility checks passed.
- Independent browser review verified setup opens Settings and focuses the API-key field, ordinary Settings focuses Done, shortcut recording enters capture and Escape returns the unchanged state, diagnostics starts closed, and 380 × 430 home/modal layouts have no horizontal overflow and allow vertical scrolling. Screenshots were returned inline; no local screenshot files were saved. The browser had no Tauri IPC, so it could not verify native registration, secure-key readiness, microphone capture, or recovery.
- The compiled native app started, but the automation window inventory could not target it and the debugging port was unavailable. Native tray/hotkey/conflict checks, actual microphone and restart permission readiness, off-window Escape/startup/finalization cancellation, repeated successful originals, and combined paste/recovery remain unverified in this pass. The final startup completion/error home-state refresh is implemented and builds; it was not exercised by the browser fixture. Implementation is complete; acceptance is partial. [UX verification](verification/ux-verification.md) records the evidence and limits. TASKS.md retains Task 10's previous combined Windows gap; no Milestone 3 work is included.

### 2026-10-04 — Local processing timing display

- At the user's request, the main window now displays audio preparation, final transcription request, cleanup request, destination readiness, paste/clipboard restoration, and total processing time. Normal dictation starts the total at release, before microphone drain/WAV encoding. Transcription and insertion retries are labeled as separate attempts.
- Use the frontend monotonic clock around the native command boundary. API durations include upload, provider processing, response reading, and validation; no separate network/model timing is claimed. Running values refresh every 250 ms and freeze when finished, failed, or stopped. Disabled or unreached stages show Skipped.
- Cancellation freezes current timing, generation guards prevent late requests from changing a newer attempt, and new dictation/discard clears the display. Timings remain local in memory for the current attempt only; no telemetry, content logging, or persistent history is added. Record this instrumentation as a completed substep of Task 13; corpus measurements and latency targets remain pending.
- Verification: 151 deterministic frontend checks and the production build passed. Four timing-focused checks cover release versus speaking time, separate API durations, cleanup fallback/refused-paste retry, failures, stop/retry isolation, and late responses; the final refined transcription suite passed all 26 checks. All 12 rendered Edge fixture tests passed, including live refresh, stop/discard behavior, retained completed timings, and a 380 × 430 layout. The narrow timing panel was visually inspected. The ordinary browser runner hung after its assertions during server teardown; a run with the same fixture/tests and an explicitly managed server completed successfully. No new physical-microphone or real-provider latency measurements are claimed.

### 2026-10-05 — Windows packaging candidate

- Package the current single-segment application as a per-user Windows x64 NSIS installer, version 0.1.0. Retain the existing application identifier, credential target and icon for continuity. WebView2 uses the download bootstrapper when needed. Required permissions, build commands and signing steps are in [Windows release guide](../../desktop/RELEASE.md).
- Added a repeatable Windows release command with locked dependency installation, high/critical npm advisory gating, frontend/browser/native checks, production packaging, credential-leak scans, and a manifest/checksum. Updated source-map-js from 1.2.1 to 1.2.2 after the release audit found its high-severity advisory. The final npm audit reported zero vulnerabilities.
- Fixed Windows Playwright teardown by owning the fixture server directly. Load Windows PowerShell's own security/utility modules explicitly when npm inherits PowerShell 7's module path; compiler/browser temporary files stay under the workspace target directory.
- Verification: 165 frontend checks, 19 rendered Edge checks, 26 native tests (seven opt-in tests ignored), formatting, production build and four scanner regression tests passed. Default and saved-key/app-profile leak scans passed without printing secrets or making provider requests. The full unsigned release command exited 0. Installer checksum and acceptance evidence are in [Task 17 verification](../verification/task17-verification.md).
- Installed the verified candidate for the current Windows user; installer exited 0 and registered version 0.1.0. The installed executable launched with a BYOK Dictation main-window title. Full-byte payload comparison passed after accounting for Tauri's three-byte NSIS bundle marker; the standalone build is restored after bundling. Accordingly, the signing workflow checks the signed installer first and verifies the actual installed payload through a separate signature/timestamp gate.
- Physical microphone, real insertion, tray/settings interaction, reboot, suspend/resume, device changes and final trusted signing remain pending. No CurrentUser code-signing certificate was found. Task 17 is partial; no segmentation or broader privacy-audit completion is claimed.
- After startup, the saved-key/app-profile scan could not read WebView2's locked Cookies file and correctly reported an incomplete audit. The app remains open for the user's microphone check; rerun this scan after tray Quit. The earlier pre-launch scan passed completely.

## macOS port

### October 7, 2026 — macOS MP-00 shell

- Installed Rust/Cargo 1.99.0 and rustfmt in the user's standard account. Kept locked npm/Rust dependencies. Captured six Mac compiler errors from Windows-only `hwnd()` calls before isolating the unchanged Windows insertion module behind target configuration.
- Added IPC-compatible fail-closed insertion/clipboard stubs, a visible Mac probe notice, disabled unsupported key entry, fixed anonymous WKWebView microphone options, and fixed-overlay controls under Developer diagnostics. Credentials, provider transport and actual dictation remain unavailable on Mac.
- Added local ad-hoc signed app/DMG configuration with microphone usage text and audio-input entitlement. Retained application identity and Windows NSIS config. The initial linker-only signature omitted entitlements; explicit ad-hoc bundle signing fixed that. DMG packaging passed outside the sandbox.
- Verification: 165 frontend tests, 23 Mac native tests (one provider test ignored), production build, formatting, bundle signature/entitlement inspection and DMG integrity passed. Native development and Vite-independent packaged main/overlay rendering were observed; Copy test text visibly refused. See [MP-00 evidence](verification/macos-mp-00-verification.md) for commands, artifact checksum and the development UI wrapper caveat.
- MP-00 is complete. MP-01 through MP-10 remain open, including actual microphone/physical-hotkey/Accessibility/Keychain/provider checks, clipboard preservation, Windows native regression, supported OS decisions and trusted distribution. This is a runnable probe shell, not Mac feature parity.

### October 7, 2026 — Platform adapter follow-up

- Put native insertion selection and the read-only platform capability report in `src-tauri/src/platform/mod.rs`. The frontend adapter in `src/platform.ts` owns platform wording, accelerator presentation, probe notices and feature flags. Each WebView initializes it before rendering; missing/malformed metadata disables capabilities. Views no longer detect the OS independently.
- Windows omits Mac overlay fixtures and retains credential setup, Ctrl+V and tray wording. Mac uses Command/Option labels and menu-bar wording while canonical shortcut strings remain unchanged in preferences and plugin registration. Key entry is gated by native storage capability, without probing unsupported storage first.
- The overlay can additionally read non-sensitive platform metadata. Native dispatch still denies credentials, clipboard, insertion and application state mutations, and denies unrecognized WebView labels. Added authorization tests for that boundary.
- Verification: 169 frontend tests, 21 rendered Chrome checks with explicit Windows/Mac metadata fixtures, 25 Mac native tests (one provider test ignored), production app/DMG build and formatting passed. Native Mac UI showed adapter-provided labels and disabled credential entry. Windows native acceptance and physical input remain unverified. See [platform adapter evidence](verification/platform-adapter-verification.md).

### October 7, 2026 — MP-01 cleanup

- Observed Accessibility denial in the packaged app. Granted-access destination/caret checks remain pending; MP-01 is incomplete.
- Removed the temporary MP-01 harness, UI/IPC wiring, disposable fixtures, separate verification note and logs at the user's request. Keep future probe work compact and avoid adding disposable test scaffolding to the codebase.

### October 11, 2026 — macOS probe 2 implementation

- Added compile-time Mac insertion selection in `platform/mod.rs` with the full
  existing command contract in `platform/insertion_macos.rs`. Windows retains
  `insertion.rs`; unsupported platforms retain refusal stubs. No dependencies or
  provider behavior changed. Mac diagnostics use a fixed Unicode/multiline sample.
- Destination guards compare foreground PID, AX window/input identity, selection
  offsets and pointer position. Require Accessibility/event-posting access and a
  readable selection; apps without this metadata use Copy. Wait for modifiers,
  recheck after clipboard preparation, latch attempted sessions, and keep uncertain
  paste outcomes distinct from safe refusals. AppKit/AX operations run on the main
  thread; modifier and clipboard-consumer waits are asynchronous.
- NSPasteboard snapshots preserve each item's readable formats in memory. Reject
  promised/unreadable files, excessive item/format counts and backups over 64 MiB.
  AppKit may synthesize converted text formats; backups retain them, while our text
  and change count guard automatic restore. Explicit Replace skips backup; explicit
  Restore replaces current clipboard contents. App operations are serialized;
  NSPasteboard has no system-wide lock/atomic conditional write. An error before
  clearing leaves newer content intact and creates no unnecessary recovery lock.
- Verification: 169 frontend, 34 rendered UI and 29 regular native checks passed
  (two opt-in checks skipped); Windows frontend production build, Mac app/DMG
  build, formatting, Git whitespace, signature and DMG integrity passed. Privacy
  scanner regressions and pattern-only audit passed. A temporary main-thread
  native helper verified Unicode/multiline/rich/custom formats, multiple items,
  empty clipboard, newer-copy preservation, promised-file refusal and explicit
  replacement; removed the helper afterward. Native checks print no real clipboard
  or destination content.
- Packaged Copy/manual Command+V visibly inserted all three sample lines in a
  disposable TextEdit document; Restore cleared its pending backup. UI automation
  typed the base key without triggering the Carbon shortcut. Physical shortcut,
  automatic target-app paste/refusals, Accessibility recovery and saved-output
  retry checks are awaiting the user; probe 2 is not marked complete. The packaged
  app remains open in Text insertion test mode. No provider requests were made.
- DMG SHA-256: `5c2cd86097d8c87887df2230b2ae284f4a3355fc8cc1e95ba9266348e820161d`.


### October 12, 2026 — probe 2 Accessibility recovery

- The user physically exercised Control+Option+1. Packaged event history confirms
  key-down/key-up delivery; insertion refused with the Accessibility guidance.
  The user reported that permission had already been enabled, and System Settings
  showed the YapYap switch on. This is a permission acceptance failure, not a
  successful automatic paste.
- Inspection found one running YapYap process and one Spotlight-registered bundle,
  both using `desktop/src-tauri/target/release/bundle/macos/YapYap.app`. Its ad-hoc
  designated requirement is `cdhash 475b86dc4340e8154b707c9ae9ed1d43d8d78fa8`.
  No valid certificate signing identities are installed. A stale requirement/grant
  from rebuilding is consistent with the evidence; no duplicate running build
  was found. Keep the current package unchanged during permission acceptance.
- Started refreshing only YapYap's existing Accessibility entry through System
  Settings. The user authenticated with Touch ID and the stale entry was removed.
  Automatic approval review of the Open click failed with a 429 rate limit before
  executing the action; the user finished re-addition. Confirmed the new YapYap
  entry is enabled and relaunched the same unchanged bundle. The user then
  confirmed that the three-line sample pastes in TextEdit. Packaged event history
  shows multiple successful pastes with previous-clipboard restoration and a
  pointer-moved refusal. This resolves the reported stale-permission failure.
  The user also confirmed normal VS Code/browser paste and refusal after caret
  or pointer movement, app switching and target closure.
  No global permission reset or signing-requirement weakening was performed.
- Added targeted recovery and ad-hoc build-identity guidance to `desktop/README.md`.
  Platform implementation remains isolated; no app rebuild or provider call was
  needed for this recovery step. Probe 2 remains in progress.

- The user initially reported paste after holding a modifier beyond 1.5 seconds,
  with Key UP on main-key release. They clarified that paste occurs only after the
  modifier is released. The latest event pair completed paste/restoration 1.378 s
  after key-up, which does not establish a timeout failure. Requested a deliberate
  three-second hold on the frozen package before deciding whether to replace it.

- The user completed the deliberate three-second modifier hold and confirmed
  the timeout warning without paste. The frozen package satisfies this check;
  the shorter attempt was not a proven defect. No modifier timing change or
  package rebuild is retained. Requested saved-output retry in normal dictation
  with live-only text and cleanup off, using a fixed disposable spoken phrase,
  a pointer-moved refusal and an explicit shortcut retry in a new destination.


### October 13, 2026 — probe 2 continuation

- Confirmed the same packaged DMG checksum and one running YapYap process after
  the interrupted turn. No clipboard observer process was running. The prepared
  external clipboard observer had only been compiled, never executed; removed
  its source/binary without changing the clipboard.
- Native app-control reads of YapYap timed out while app inventory remained
  available. A menu-bar inspection also timed out. Requested the user to open
  YapYap from its menu bar and report whether the pending saved-output retry
  check passed. No app rebuild, permission change or provider call was made.
- The physical three-second modifier timeout remains a confirmed pass. Native
  saved-output retry and remaining packaged clipboard checks remain open; probe 2
  is not marked complete.


### October 13 — packaged saved-output and clipboard recovery

- The user confirmed that retained output pastes after focusing a new editor and
  pressing/releasing the shortcut. The packaged main window reports Inserted,
  transcription/cleanup/preparation skipped, destination check 0.01 s, paste and
  restore 0.28 s, and insertion retry total 0.29 s. This confirms native retry of
  saved output through the existing recovery route without a new provider stage.
- Native app control became available again. An external in-memory clipboard peer
  supplied disposable RTF/plain/custom formats across two items. Packaged Copy
  wrote the transcript; explicit Restore returned every format/item unchanged.
  The peer then restored the original clipboard. A promised-file metadata fixture
  was refused by safe Copy without any clipboard mutation. Explicit Replace wrote
  plain text and the UI confirmed Restore unavailable; original clipboard restored.
- Initial automatic-paste observers expired before recording the required
  transitions; those attempts did not establish a failure. The extended observer
  then passed both physical checks: automatic paste restored all rich/custom
  formats and both items, and a disposable newer copy made during the second paste
  remained intact. The user confirmed that the fixed multiline sample appeared
  both times. Packaged diagnostics at 06:48:25Z and 06:48:28Z on October 14 UTC
  (October 13 local) independently report restored clipboard and preserved newer
  clipboard respectively. The observer restored the original clipboard without
  writing clipboard data to disk; its temporary source and binary were removed.
- Group 2 is passed. Returned Shortcut test mode to Dictate and insert. No app
  rebuild or permission reset was performed during final acceptance. Group 3 and
  Windows native regression/combined manual acceptance remain open.
