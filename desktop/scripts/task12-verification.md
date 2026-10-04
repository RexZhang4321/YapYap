# Task 12 failure recovery audit

Recorded October 3–4, 2026 (America/Los_Angeles).

## Recovery policy and implementation

The app retains original audio in RAM until usable canonical text exists or explicit discard. Failed/empty/malformed canonical responses keep that audio for an identical retry. Canonical text remains independently recoverable until explicit discard or exit, including after cleaned insertion. Cleanup failure selects canonical text with a fixed nonfatal warning. Failed or uncertain insertion retains all available transcripts; only a confirmed refusal before paste permits automatic insertion retry. Live text remains provisional throughout.

This audit found and fixed a recovery gap: canonical text containing NUL was accepted as success and released audio, while native insertion/Copy rejected it. Native final-STT parsing now rejects NUL before success. The frontend also validates canonical result type, NUL and the native 1 MiB UTF-8 limit before releasing audio, so later providers cannot bypass that recovery boundary.

Added **Copy provisional live text** and its explicit no-backup counterpart. Selection requires a settled current session with matching preview ownership and no recording/request/paste/clipboard-operation lock. It copies a snapshot of the exact live text even if the preview is still finishing, without changing canonical/cleaned values or dispatching paste. The UI warns that words may be incomplete, inaccurate or contain gaps. Native clipboard backup and Restore semantics remain shared with original/cleaned Copy. Discard clears audio and all three transcript sources; late callbacks cannot restore them.

Corrected the earlier Task 10 deterministic audio fixture to concatenate chunks into one channel array, matching CapturedPcm's representation. Original capture, preview conversion and whole-WAV finalization remain separate.

## Recovery matrix

| Failure or transition | Retained source and action |
| --- | --- |
| Live disconnect/backlog/timeout | Capture continues independently; retain provisional words and complete original audio; reconnect marks a gap. |
| Canonical failure/empty/malformed response | Retain complete audio and available live words; Retry transcription uploads the same WAV. Explicit provisional Copy remains available after the session settles. |
| Cleanup failure/unsafe/incomplete output | Canonical text remains exact; insert/Copy canonical fallback and show a fixed notice. |
| Destination unavailable/changed | Keep canonical, accepted cleanup and live text; use Copy. A confirmed pre-paste refusal permits original-target insertion retry without new provider requests. |
| Partial paste/unknown IPC outcome | Keep transcripts, check the destination and use explicit Copy; automatic repeat insertion is disabled. |
| Clipboard restoration failure | Keep transcript and available backup; Restore is separate from paste. Newer user clipboard contents are preserved. |
| Cancel during capture/final STT/cleanup | Explicitly discard local sources and invalidate session/preview ownership. Ignore late responses; wait for sent native work before another session. |
| Cancel after paste dispatch | Discard is refused until the outcome returns; a dispatched paste cannot be retracted. |
| New hotkey during finalization | Refuse overlapping session; retained sources stay intact. Another session starts after explicit discard and outstanding native work settles. |

## Native/source review

Whole-WAV validation precedes native upload. Canonical/cleanup requests keep atomic guards inside their blocking workers until completion. UI discard cannot abort synchronous WinHTTP: native request buffers remain alive until completion or phase timeout, while the UI suppresses late results. Timeouts are per phase and do not impose one total wall-clock deadline. Live cancellation disposes its socket and queued preview audio; stale stream/session IDs are refused. Native paste latches an attempt immediately before SendInput; no error escapes after dispatch that would authorize a repeat paste. SendInput success still does not prove destination acceptance.

No production audio/transcript/credential logging, files, analytics or third-party dictation backend were found in the audited path. Audio and recovery text stay in RAM. Exit or crash loses pending audio, transcripts and in-memory clipboard backups. This MVP offers running-app recovery, not crash recovery. Provider requests already sent cannot be retracted by discard. Test fixtures and opt-in helper artifacts are synthetic and separate from production retention.

## Manual combined Windows follow-up

1. Enable live preview and cleanup, prepare the physical microphone, focus a disposable Notepad/VS Code/browser input, hold/speak/release. Verify live words before release, final/cleaned insertion at the original cursor, success hiding, retained original and clipboard restoration.
2. Interrupt the network while recording, then before final transcription. Verify local audio and provisional words survive, retry after reconnection, and explicit provisional Copy if canonical transcription still fails.
3. Change the destination during finalization/cleanup. Verify safe refusal, retained original/cleaned/live text, Copy/Restore and original-target retry without another API request.
4. Cancel in each cancellable stage, wait for outstanding work, then dictate again. Verify late results never reappear or insert. Test a busy hotkey and repeated release/retry events.

The new combined physical/native GUI pass remains pending: Task 10's desktop automation call hung before its check started. Prior Task 6–9 platform reports and Task 11's real synthetic cleanup request remain separately documented. Deterministic audit results below do not claim a new network/microphone/key-hold/application observation.

## Observed final checks

- All 124 frontend checks passed: 56 top-level checks plus 68 matrix subchecks. The recovery audit covers 60 fault combinations and eight cancellation/late-result combinations, along with independent preview/paste boundaries, delayed overlay cancellation and malformed canonical responses.
- All 25 native tests passed; seven opt-in helpers were skipped in the ordinary run. The native NUL regression passed. Frontend and native builds, Rust formatting and whitespace checks passed.
- Four privacy-scanner regression tests passed. The saved-key/app-data audit scanned 565 selected files/build outputs and 399 Git objects without matching exposures. It never printed or exported the key. This audit preceded the final model-only rebuild.
- On October 4 the user requested GPT-6 Luna. Current implementation, UI and requirements now use exactly `gpt-6-luna`. Its [official model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) supports the existing Responses API and `none` reasoning setting. The endpoint, prompt/data separation, preservation guard and canonical fallback are unchanged; historical Task 11 evidence retains its original model name.
- The opt-in real saved-key GPT-6 Luna probe succeeded with synthetic `um hello world` input. Fixed boolean output confirmed changed formatting, filler removal, nonempty output and preserved substantive words; elapsed request time was 2.65 seconds. No credential or returned transcript was printed. This single fixture is access evidence, not a representative latency or quality benchmark.

Task 12 implementation and its deterministic audit are complete. Milestone 2 implementation was committed one task at a time; the full new combined Windows manual pass remains pending. No Milestone 3 work is included.
