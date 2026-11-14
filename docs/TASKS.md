# YapYap — Open tasks

What is left to do, in build order. Tasks 0–12 (capability probes, session lifecycle, live overlay, cleanup and the failure-recovery audit) are complete; their checklists and evidence are in the [completed task list](archive/TASKS-completed.md).

Status markers: `[ ]` not started, `[-]` in progress, `[x]` verified complete.

## Working rules

- Keep the app runnable after every task.
- Demonstrate each task with real platform and API behavior before starting the next.
- Use deterministic fixtures and fakes for regular tests; keep real API checks opt-in.
- Preserve the source-of-truth order: original audio → canonical transcript → cleaned transcript → live transcript.
- Keep audio in memory only; release it after successful finalization or explicit discard.
- Add recovery, cancellation and privacy behavior with each capability.
- Record non-obvious choices in [DECISIONS.md](DECISIONS.md).

## Acceptance still open on shipped work

- [-] **Task 10, combined Windows flow.** Verify on Windows that the overlay does not change the insertion target in the complete record → live overlay → transcribe → clean up → insert flow. Source and deterministic checks pass; the combined native run is pending.
- [-] **UX checkpoint, native flow.** Verify the native recording and recovery interaction end to end. Rendered browser checks pass, but they have no Tauri IPC.
- [ ] **UX checkpoint, physical Windows acceptance.** Confirm the tray and hotkey flow with a physical microphone, real application targets, restart readiness, permission denial and retry, shortcut conflicts, and cancellation during capture and finalization.
- [ ] **Windows native regression after the macOS port.** Work through the [Windows regression checklist](verification/windows-regression-verification.md).

## Milestone 3 — Full P0 processing pipeline

### 13. Evaluation baseline

- [x] Add a local per-stage timing display for audio preparation, final transcription, cleanup, destination checks, insertion and total time after release.
- [ ] Create a small corpus covering short and long speech, corrections, numbers, identifiers and intended languages.
- [ ] Measure first-visible-text and release-to-insertion latency, canonical accuracy, cleanup meaning changes and total API cost.
- [ ] Set acceptance targets from the real probe results, including typical and slow-case latency.
- [ ] Save the whole-recording baseline for comparison with segmentation.

Done when: the same corpus can measure speed, accuracy, cleanup safety and cost before and after optimization.

### 14. Voice activity detection and segmentation

- [ ] Add local VAD behind an isolated interface.
- [ ] Emit ordered segment IDs and boundary timestamps.
- [ ] Flush the final unfinished segment on stop.
- [ ] Keep the single-segment path as a fallback.
- [ ] Set a maximum segment duration for speech without pauses.
- [ ] Test pauses, silence, boundary word clipping, repeated words and continuous speech.

Done when: audio coverage has no gaps, any boundary overlap is explicit, and transcript checks show no lost or duplicated boundary words in the evaluation corpus.

### 15. Incremental canonical transcription

- [ ] Transcribe completed segments while recording continues.
- [ ] Accumulate canonical segments in order.
- [ ] Bound concurrency, define the backlog policy and add retry behavior.
- [ ] Test out-of-order completion and a failed middle segment without silently inserting an incomplete transcript.
- [ ] Measure whether release normally waits only for the final segment; include whole-session cleanup in total latency.
- [ ] Release in-memory segment audio only after its recovery requirements are satisfied.

Done when: the evaluation corpus meets the agreed latency and accuracy targets against the whole-recording baseline.

### 16. Privacy and lifecycle audit

- [ ] Verify audio stays in memory and is released after successful finalization or explicit discard.
- [ ] Verify dictated text, audio and credentials are absent from ordinary logs.
- [ ] Confirm no analytics or third-party dictation backend is used.
- [ ] Verify retry, cancel and recovery behavior for interrupted sessions.
- [ ] Document what is sent to the configured provider and when.

Done when: the default lifecycle matches the project's local-first privacy requirements.

### 17. Packaging and release checks

- [x] Build a Windows installer. A per-user Windows x64 NSIS package is generated; see [Task 17 verification](verification/task17-verification.md).
- [x] Document required Windows permissions. See the [Windows release guide](../desktop/RELEASE.md).
- [ ] Test startup, restart, suspend/resume and microphone changes.
- [-] Add a Windows signing workflow before external distribution. The release script supports a local signing config and checks signatures; verification with a real certificate or signing service is pending.
- [ ] macOS trusted distribution: Developer ID signing for release, notarization and downloaded-app acceptance. Feature parity itself is complete; see the [macOS probe results](MACOS_PROBES.md).

Done when: the P0 flow is installable and manually verified on each supported platform.

## Deferred after P0

- [ ] Broader macOS OS and hardware coverage.
- [ ] Personal vocabulary and application-aware context.
- [ ] Undo, richer raw-vs-cleaned comparison UI, and polished cleanup mode.
- [ ] True inline live transcription.
- [ ] Formatting voice commands.
- [ ] Per-application profiles.
- [ ] Adaptive vocabulary.
- [ ] Offline/local model support.
- [ ] Optional local history and settings sync.
