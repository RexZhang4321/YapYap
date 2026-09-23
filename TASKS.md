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

- [ ] Add minimal API-key entry and validation.
- [ ] Store the key using the operating-system-backed secure storage mechanism.
- [ ] Verify the key can be retrieved after restart without appearing in plaintext settings or logs.

Done when: secure key entry, storage, and retrieval work on Windows.

### 5. File-transcription API probe

- [ ] Send an in-memory recording to `gpt-transcribe` through the file-transcription API without saving audio to disk.
- [ ] Display the returned transcript in a debug view.
- [ ] Handle missing, invalid, expired, and network-failed requests.
- [ ] Verify account access and request format with a real API call.
- [ ] Retain audio in memory for retry on failure and release it after successful finalization or explicit discard.

Done when: a real recording can be transcribed with the user’s key and a failed request can be retried or discarded.

## Milestone 1 — Text destination and basic UX

### 6. Session lifecycle and transcript insertion

- [ ] Define recording, finalizing, ready, inserted, failed, and discarded states.
- [ ] On stop, transcribe the complete recording as one segment and insert the canonical result.
- [ ] Define cancellation and starting another dictation during finalization.
- [ ] Ignore late responses from cancelled sessions and prevent duplicate insertion.
- [ ] Retain results for Copy/retry when insertion fails or the destination is uncertain.
- [ ] Test Unicode, newlines, URLs, filenames, identifiers, and technical terminology.

Done when: `record → transcribe → insert` works independently of the live overlay, including cancellation and recovery.

### 7. Live-transcription probe

- [ ] Stream microphone audio to `gpt-live-transcribe`.
- [ ] Print or display transcript deltas in a debug view.
- [ ] Measure time to first visible text.
- [ ] Handle cancellation, disconnect, and reconnect.
- [ ] Continue preserving the local original-audio buffer independently.
- [ ] Verify account access and streaming behavior with a real API call.

Done when: words appear while speaking and the recording remains recoverable after a live-stream failure.

### 8. Minimal floating overlay

- [ ] Add a small always-on-top overlay window.
- [ ] Display recording and processing states.
- [ ] Display fake/probe text before connecting it to live transcription.
- [ ] Hide the overlay after success; keep error recovery accessible until resolved or discarded.
- [ ] Verify it does not steal focus from the target application.

Done when: the overlay lifecycle works while another application remains active.

### 9. Live transcription overlay

- [ ] Connect live transcript deltas to the overlay.
- [ ] Mark live text clearly as provisional.
- [ ] Show listening, processing, and error states.
- [ ] Do not insert provisional text into the target application.

Done when: `hotkey → speak → see provisional text → stop` works without editing the foreground app.

## Milestone 2 — First experience MVP

### 10. Single-segment integration

- [ ] Connect the live overlay to the existing record-to-insert session lifecycle.
- [ ] Keep live and canonical transcripts as separate values.
- [ ] Verify final transcription still uses the complete original audio.
- [ ] Verify the overlay does not change the insertion target.
- [ ] Show finalizing/completed/error states.

Done when: the complete real flow works without VAD or incremental transcription.

### 11. Conservative cleanup

- [ ] Send the canonical transcript to `gpt-5.6-luna`.
- [ ] Add light cleanup and a bypass that uses the canonical transcript.
- [ ] Preserve meaning, tone, numbers, identifiers, URLs, filenames, and technical terms.
- [ ] Insert cleaned text on success.
- [ ] Fall back to canonical text if cleanup fails.
- [ ] Provide Copy original transcript and retain the canonical text for the session until explicit discard.

Done when: cleanup improves ordinary dictation without becoming the only recoverable transcript.

### 12. Failure recovery audit

- [ ] Test live-transcription failure.
- [ ] Test canonical-transcription failure.
- [ ] Test cleanup failure.
- [ ] Test insertion failure.
- [ ] Verify recovery using canonical or live text and audio retry where available.
- [ ] Test cancellation, late responses, repeated insertion attempts, and a new dictation during finalization.
- [ ] Preserve session transcripts until the user’s result is safely inserted or explicitly discarded.
- [ ] Verify API retries use retained in-memory audio; document that app exit or crash loses pending audio.

Done when: no downstream failure silently discards dictated text while the app remains running; crash recovery is outside the initial scope.

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
