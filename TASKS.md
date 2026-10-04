# BYOK Dictation Tool — Incremental Task List

This list follows the capability-by-capability build order. Each task should be demonstrated with the real platform/API behavior before the next task is started.

## Working rules

- [ ] Keep the app runnable after every task.
- [ ] Develop and verify the initial release on Windows; macOS is deferred.
- [ ] Capture one short manual-test note or artifact for each completed task.
- [ ] Update [DECISIONS.md](DECISIONS.md) with decisions, progress, and verification evidence as work proceeds.
- [ ] Use deterministic fixtures/fakes for regular tests; keep real API checks opt-in.
- [ ] Preserve the source-of-truth order: original audio → canonical transcript → cleaned transcript → live transcript.
- [ ] Keep audio in memory only; release it after successful finalization or explicit discard. API retries work while the app remains running; crash recovery is not guaranteed.
- [ ] Add recovery, cancellation, and privacy behavior with each capability; later audits verify the combined flow.
- [ ] Keep `StreamingSTT`, `FinalSTT`, and `CleanupModel` behind small interfaces from the start.

Status markers: `[ ]` not started, `[-]` in progress, `[x]` verified complete, `[!]` blocked or needs a decision.

## Milestone 0 — Real capability probes

### 0. Scope and implementation decisions

- [x] Confirm Windows-only initial release; defer macOS.
- [x] Choose Tauri + TypeScript + Vite as the initial stack; record the rationale in [DECISIONS.md](DECISIONS.md).
- [x] Confirm available Windows test devices: Elgato Wave:3 microphone, Notepad, VS Code, and Chrome/Edge browser input targets. Capture and insertion behavior remain for their respective probes.
- [x] Defer macOS checks for hotkeys, capture, secure storage, insertion, overlay, and packaging until macOS work begins.
- [x] Prefer hold-to-talk; Task 1 verified press and release events on Windows. Retain toggle only as a fallback if later testing exposes missed releases.
- [x] Choose memory-only audio buffering with API retries while running and no crash-recovery guarantee.
- [x] Record the agreed decisions, rationale, and revisit conditions in [DECISIONS.md](DECISIONS.md).

Done when: platform scope, stack, verification access, and recovery guarantees are explicit.

### 1. Global keybinding probe

- [x] Create the smallest background/tray app with a configurable shortcut. The user verified Ctrl+Alt+F7 after rebinding and confirmed the previous F8 binding stopped.
- [x] Log key-down and key-up events with timestamps. The user supplied two complete press/release cycles; the temporary toggle diagnostic was removed.
- [x] Test while Notepad and VS Code have focus; the user reported that both worked.
- [x] Verify Ctrl+Alt+F8 is available on the Windows test machine through live key events.
- [x] Choose hold-to-talk for the initial interaction: press starts and release stops. Keep toggle as a contingency for a future reliability failure.

Done when: the interaction is reliable on Windows, with any limitation and fallback documented.

### 2. Text-insertion probe

- [x] Capture the focused application/input target on hotkey activation; live insertion succeeded in blank Notepad and VS Code editors.
- [x] Back up the clipboard and paste a fixed test string; live Notepad and VS Code insertion succeeded, and the user reported the clipboard flow works.
- [x] Restore the clipboard where practical without overwriting a newer user copy; ordinary restore worked, and the newer-copy smoke check passed.
- [x] Add timeout and insertion-failure reporting; changed-target failures and the modifier timeout visibly warn without pasting.
- [x] Test Notepad, VS Code, and a browser input; Notepad and VS Code passed in observed checks, and the user reported browser paste works.
- [x] Test app switching, cursor movement, and closing the target before insertion; the user confirmed no paste and a visible warning in all three cases.
- [x] Retain the result and offer Copy when the intended destination cannot be safely identified; the user confirmed Copy works after the target-switch warning.

Done when: the fixed string inserts reliably, uncertain targets use Copy, and clipboard contents are not silently lost.

### 3. Microphone recording probe

Implemented and verified on Windows. The first live attempt returned zero PCM frames; microphone preparation, diagnostics, a live input meter, and in-memory playback were added before successful verification.

- [x] Start and stop recording from the keybinding probe; successful capture/playback confirmed by the user.
- [x] Capture microphone audio as an in-memory PCM buffer; encode WAV in memory for playback.
- [x] Record duration, sample rate, channel count, and selected device.
- [x] Add microphone permission-denied handling; the user confirmed the denial check works.
- [x] Test microphone disconnect/reconnect behavior; the user confirmed partial capture and recovery work.
- [x] Add a small playback or inspection utility for captured audio; the user confirmed playback and clearing work.

Done: the user confirmed successful recording/playback and all three remaining Windows checks: clearing, permission denial, and disconnect/reconnect.

### 4. API-key storage probe

Implemented and verified on Windows. The user confirmed successful key entry, storage, and validation, then validation after an app restart without re-entering the key.

- [x] Add minimal API-key entry and validation. Masked entry, Save, Validate, and Remove are implemented; the user confirmed successful validation with their saved key. A real OpenAI request with an invalid fixture returned the expected authentication failure.
- [x] Store the key using the operating-system-backed secure storage mechanism. Windows Credential Manager fixture storage, replacement, and deletion passed.
- [x] Verify the key can be retrieved after restart without appearing in plaintext settings or logs. A fresh process retrieved a disposable native credential, and the user confirmed the saved key was detected and validated after restarting the actual app without re-entry. Source checks confirmed no app-owned plaintext credential file or credential logging; secrets are not returned through IPC.

Done: secure key entry, storage, retrieval, and validation after restart work on Windows.

### 5. File-transcription API probe

Implemented and verified against the Task 5 completion criteria. The user confirmed successful live transcription with the saved key and that the failed-request retry flow works. Audio release, explicit discard, duplicate-request prevention, and late-response suppression passed deterministic tests; separate live confirmation of release/discard was not reported.

- [x] Send an in-memory recording to `gpt-transcribe` through the file-transcription API without saving audio to disk. WAV bytes use binary IPC and native WinHTTP; the user confirmed the live transcript appears.
- [x] Display the returned transcript in a debug view. The user confirmed the transcript appears in the updated probe.
- [x] Handle missing, invalid, expired, and network-failed requests. Fixed error messages implemented; deterministic error/retry checks and real invalid-key authentication check passed. The user confirmed the live network-failure retry flow works. HTTP 401 does not distinguish invalid, expired, and revoked credentials.
- [x] Verify account access and request format with a real API call. OpenAI rejected the invalid fixture as expected, and the user confirmed successful transcription with the saved key.
- [x] Retain audio in memory for retry on failure and release it after successful finalization or explicit discard. The user confirmed live retry works; deterministic tests verify release/discard, duplicate requests, and late-response suppression.

Done: a real recording can be transcribed with the user's key and a failed request can be retried using retained audio, both confirmed by the user.

## Milestone 1 — Text destination and basic UX

### 6. Session lifecycle and transcript insertion

- [x] Define recording, finalizing, ready, inserted, failed, and discarded states; idle is the initial state.
- [x] On stop, transcribe the complete recording as one segment and insert the canonical result. Synthetic microphone capture with real OpenAI transcription and native paste succeeded in Notepad and VS Code.
- [x] Define cancellation and starting another dictation during finalization. One session at a time; cancel recording/transcription, wait for outstanding native work, and discard retained results before another dictation. Paste dispatch is the noncancellable commit boundary.
- [x] Ignore late responses from cancelled sessions and prevent duplicate insertion. Deterministic tests cover late results and partial/unknown paste outcomes; repeated native insertion was refused in a Windows check.
- [x] Retain results for Copy/retry when insertion fails or the destination is uncertain. Real hotkey insertion retry and native Copy/Restore recovery passed.
- [x] Test Unicode, newlines, URLs, filenames, identifiers, and technical terminology. Exact fixtures passed deterministic checks and were visually verified through native Notepad insertion.

Done: `record → transcribe → insert` works independently of the live overlay, including cancellation and recovery. [Windows verification note](desktop/scripts/task6-verification.md) distinguishes synthetic microphone/shortcut replay from real physical-device checks. Next: Task 7.

### 7. Live-transcription probe

- [x] Stream microphone audio to `gpt-live-transcribe`. WebView PCM is independently converted to 24 kHz mono PCM16 and sent through a native authenticated WebSocket.
- [x] Print or display transcript deltas in a debug view. A separate provisional view received 20 real deltas before release in the synthetic-microphone check.
- [x] Measure time to first visible text. The debug view measures capture-start to first visible nonempty update; observed synthetic checks ranged from 1.00 to 1.73 seconds, without establishing physical-microphone latency targets.
- [x] Handle cancellation, disconnect, and reconnect. Startup/active cancellation and reconnect passed integration checks; disconnect recovery used real socket termination plus an injected fixed notification, with independent deterministic native socket-failure coverage.
- [x] Continue preserving the local original-audio buffer independently. After a live failure, 9.51 seconds of original audio remained playable and successfully produced a canonical transcript through an explicit real API request.
- [x] Verify account access and streaming behavior with a real API call. The saved-key configuration probe and real synthetic-audio delta/completion checks passed without returning credentials to the UI.

Done: words appear before release, and the original recording survives live-stream failure. The user confirmed physical microphone and network-outage checks on October 3, 2026. [Windows verification note](desktop/scripts/task7-verification.md) records evidence and synthetic/device/network test boundaries. Next: Task 8, minimal floating overlay.

### 8. Minimal floating overlay

- [x] Add a small always-on-top overlay window. A separate hidden-on-start, nonfocusable, mouse-through WebView is positioned in the foreground monitor's work area.
- [x] Display recording and processing states. Session updates also show retained results and recovery warnings.
- [x] Display fake/probe text before connecting it to live transcription. Only fixed status/placeholder copy crosses into the overlay; live deltas remain Task 9.
- [x] Hide the overlay after success; keep error recovery accessible until resolved or discarded. Native Notepad insertion after a fixture failure/retry hid the overlay; cancellation cleared audio and hid it. Recovery stays available through the tray's main probe.
- [x] Verify it does not steal focus from the target application. Native observations preserved Notepad's foreground window through recording, processing, recovery, and hiding; VS Code window focus was also preserved. No new VS Code editor/browser insertion pass is claimed.

Done: the overlay lifecycle works while another application remains active. [Windows verification note](desktop/scripts/task8-verification.md) records local fixture, real-window, and tooling boundaries. Next: Task 9, live transcription overlay.

### 9. Live transcription overlay

- [x] Connect live transcript deltas to the overlay. Same-phase text updates are serialized/coalesced into a bounded native snapshot; real streaming words appeared before release with synthetic microphone input.
- [x] Mark live text clearly as provisional. The passive overlay labels preview text and reconnect gaps; Unicode/long-text layouts were checked in both WebViews.
- [x] Show listening, processing, and error states. Local fixtures verified preview failure/reconnect, delayed finalization, cancellation, discard, and a new session with live preview disabled.
- [x] Do not insert provisional text into the target application. A disposable native Windows input stayed focused and unchanged in local and real-streaming checks; deterministic checks verify that only canonical text reaches insertion.

Done: `hotkey → speak → see provisional text → stop` works without editing the foreground app, verified with synthetic microphone input and shortcut-handler replay. The user also reported the manual test works on October 3, 2026. [Windows verification note](desktop/scripts/task9-verification.md) records real-streaming, local-fixture, and user-observed boundaries, plus feedback about overlay dismissal after transcription. Next: Task 10, single-segment integration.

## Milestone 2 — First experience MVP

### 10. Single-segment integration

- [x] Connect the live overlay to the existing record-to-insert session lifecycle. Existing normal dictate mode owns the combined flow.
- [x] Keep live and canonical transcripts as separate values.
- [x] Verify final transcription still uses the complete original audio. Byte-identical full-WAV retry is covered deterministically.
- [-] Verify the overlay does not change the insertion target. Source/deterministic checks pass; the new combined Windows observer run is pending.
- [x] Show finalizing/completed/error states. Successful insertion hides the overlay immediately.

Implemented and automatically checked; the complete real combined-flow verification remains pending. [Task 10 verification note](desktop/scripts/task10-verification.md) records the desktop automation timeout and evidence boundaries. No VAD or incremental transcription is introduced.

### 11. Conservative cleanup

- [x] Send the canonical transcript to `gpt-6-luna`.
- [x] Add light cleanup and a bypass that uses the canonical transcript.
- [x] Preserve meaning, tone, numbers, identifiers, URLs, filenames, and technical terms.
- [x] Insert cleaned text on success.
- [x] Fall back to canonical text if cleanup fails.
- [x] Provide Copy original transcript and retain the canonical text for the session until explicit discard.

Implemented and checked with deterministic fixtures and a real saved-key synthetic cleanup request. [Task 11 verification](desktop/scripts/task11-verification.md) records preservation guards, canonical recovery, API evidence and remaining manual/semantic limits. Full corpus evaluation remains Task 13.

### 12. Failure recovery audit

- [x] Test live-transcription failure.
- [x] Test canonical-transcription failure.
- [x] Test cleanup failure.
- [x] Test insertion failure.
- [x] Verify recovery using canonical or live text and audio retry where available.
- [x] Test cancellation, late responses, repeated insertion attempts, and a new dictation during finalization.
- [x] Preserve session transcripts until the user’s result is safely inserted or explicitly discarded.
- [x] Verify API retries use retained in-memory audio; document that app exit or crash loses pending audio.

Implemented and audited with a combined deterministic failure matrix and native/source review. [Task 12 verification](desktop/scripts/task12-verification.md) records recovery behavior, the malformed-canonical fix, GPT-6 Luna access and the remaining combined Windows manual gap. Exit/crash recovery is outside the initial scope. Milestone 2 implementation is complete; Task 10's full live validation remains pending.

## Milestone 3 — Full P0 processing pipeline

### 13. Evaluation baseline

- [ ] Create a small corpus covering short/long speech, corrections, numbers, identifiers, and intended languages.
- [ ] Measure first-visible-text and release-to-insertion latency, canonical accuracy, cleanup meaning changes, and total API cost.
- [ ] Set acceptance targets from the real probe results, including typical and slow-case latency.
- [ ] Save the whole-recording baseline for comparison with segmentation.

Done when: the same corpus can measure speed, accuracy, cleanup safety, and cost before and after optimization.

### 14. Voice activity detection and segmentation

- [ ] Add local VAD behind an isolated interface.
- [ ] Emit ordered segment IDs and boundary timestamps.
- [ ] Flush the final unfinished segment on stop.
- [ ] Keep the single-segment path as a fallback.
- [ ] Set a maximum segment duration for speech without pauses.
- [ ] Test pauses, silence, boundary word clipping, repeated words, and continuous speech.

Done when: audio coverage has no gaps, any boundary overlap is explicit, and transcript checks show no lost or duplicated boundary words in the evaluation corpus.

### 15. Incremental canonical transcription

- [ ] Transcribe completed segments while recording continues.
- [ ] Accumulate canonical segments in order.
- [ ] Bound concurrency, define the backlog policy, and add retry behavior.
- [ ] Test out-of-order completion and a failed middle segment without silently inserting an incomplete transcript.
- [ ] Measure whether release normally waits only for the final segment; include whole-session cleanup in total latency.
- [ ] Release in-memory segment audio only after its recovery requirements are satisfied.

Done when: the evaluation corpus meets the agreed latency and accuracy targets against the whole-recording baseline.

### 16. Privacy and lifecycle audit

- [ ] Verify audio stays in memory and is released after successful finalization or explicit discard.
- [ ] Verify dictated text/audio and credentials are absent from ordinary logs.
- [ ] Confirm no analytics or third-party dictation backend is used.
- [ ] Verify retry/cancel/recovery behavior for interrupted sessions.
- [ ] Document what is sent to the configured provider and when.

Done when: the default lifecycle matches the project’s local-first privacy requirements.

### 17. Packaging and release checks

- [ ] Build a Windows installer.
- [ ] Document required Windows permissions.
- [ ] Test startup, restart, suspend/resume, and microphone changes.
- [ ] Add Windows signing workflow before external distribution.

Done when: the P0 flow is installable and manually verified on Windows.

## Deferred after P0

- [ ] macOS support: verify hotkeys, capture, secure storage, insertion, overlay, permissions, packaging, and signing/notarization.
- [ ] Personal vocabulary and application-aware context.
- [ ] Undo, richer raw-vs-cleaned comparison UI, and polished cleanup mode.
- [ ] True inline live transcription.
- [ ] Formatting voice commands.
- [ ] Per-application profiles.
- [ ] Adaptive vocabulary.
- [ ] Offline/local model support.
- [ ] Optional local history and settings sync.
