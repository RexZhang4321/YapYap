# Task 9 Windows verification

Recorded on October 3, 2026 (America/Los_Angeles).

## Implementation

- The main window remains the session/audio owner. Live changes and session changes publish a snapshot containing owner generation, revision, phase, provisional text, fixed preview status, and reconnect-gap flag. Only the current session's enabled preview is published, after destination capture in normal dictate mode.
- The overlay retains the latest 2,048 UTF-16 units, avoids splitting an emoji at the start of the tail, renders plain text, wraps long identifiers, and follows the newest lines inside the existing 440 × 148 logical-pixel window. Its header labels live words Provisional. Listening, connecting, processing, retained-result, preview-failure, and session-recovery feedback are separate from the canonical transcript.
- Serialization/coalescing now compares content rather than phase alone. Native payload validation and frontend receive validation bound text and reject inconsistent hidden/off payloads. Owner/revision guards reject stale updates. Hide/discard clears the native snapshot and sends a clearing event to the hidden overlay DOM. The overlay remains nonfocusable, mouse-through, and restricted to reading its snapshot and event subscription.

## Observed integration results

- The local pass used the existing Fake microphone and fixed live/final-STT fixtures. Real AudioWorklet capture, session callbacks, binary-independent preview plumbing, native window commands, and both WebViews ran. Chinese text, emoji, newlines, and a literal HTML-looking fixture appeared as text; no image node was created. A long preview remained within the window, carried at most 2,048 UTF-16 units, and showed its latest line. Listening, long-text, preview-failure, and processing screenshots were visually reviewed.
- Preview failure retained the words and left the session recording. Explicit reconnect kept earlier preview text and marked a gap. Release in live probe mode retained original audio without a canonical transcript or paste. Discard cleared both snapshots and DOM; an injected old-stream delta after cancellation could not restore words.
- A normal dictate-mode local run captured the disposable input, displayed provisional text during delayed final transcription, then cancelled before the fixed canonical result. The late result was suppressed and no paste occurred. A new session with preview disabled had an empty preview snapshot and fixed Listening status. An oversized native update was rejected without changing the hidden state/revision.
- The final local native-input run observed 28 samples with the overlay visible. Foreground focus stayed on the disposable WinForms input and its fixed text remained unchanged throughout the listening/failure/reconnect/processing checks. The fixture establishes focus with a click and restores the pointer afterward.
- A separate fresh-app run used the actual authenticated native streaming transport and fixed synthetic speech. Real provider deltas produced a 25-character provisional preview before release; the Listening screenshot was visually reviewed. Release retained original audio and produced no canonical transcript or paste in live probe mode. Discard cleared native state and DOM, and a following startup cancellation cleared audio/text.
- The real-streaming native-input run observed 34 visible-overlay samples with foreground focus preserved and the disposable input unchanged. The overlay command restriction check denied `has_api_key` while allowing `overlay_snapshot`; no credential or microphone controls existed in the overlay.

## Test boundaries

User follow-up on October 3: the user reports that the manual test is complete and works. They observed the overlay remaining after transcription and expected automatic dismissal or a dismiss/paste action. This records a user-observed manual pass; individual application, microphone, latency, cancellation, and network subchecks were not separately specified. No behavior change was requested. The persistent Ready overlay follows the live probe's retained-session behavior; dismissal separate from discard and convenient paste are UX feedback for the combined experience.

Automated integration capture used the existing ignored Windows System.Speech WAV and process-local WebView2 fake-device/debugger flags. Shortcut events were replayed through the actual registered handler. Those automated runs do not establish a physical-microphone, full physical-key hold, Notepad/VS Code/browser, mixed-DPI, or physical-network-outage result. The user's manual pass is recorded above; unspecified subchecks remain available in the README. Real streaming did not separately exercise disconnect/reconnect; that behavior was checked through local provider events and the preexisting Task 7 transport tests.

No real recording was saved. The local pass made no provider requests. The explicit real-streaming pass uploaded only the fixed synthetic speech; credentials stayed in Rust/Windows Credential Manager. Helpers print fixed booleans/counts and save screenshots of synthetic content under ignored build output. The old Task 8 status helper was changed to summarize snapshots without printing the newly added transcript field. Test app processes and the task's Vite server are stopped after verification; flags and frontend provider patches are not persisted.

Initial helper attempts exposed test-harness newline escaping, Windows PowerShell Unicode title lookup/process-exit handling, and foreground-establishment issues; those runs were excluded and the final checks rerun successfully. The legacy Task 6/7 preparation helper did not capture this Vite module's shortcut callback; Task 9 uses Task 8's exact-module callback setup instead. The native test linker needed the documented process-local TEMP/TMP directory inside ignored target output.

## Deterministic checks

- 40 frontend checks passed. New checks cover same-phase text delivery/coalescing, Unicode tail boundaries, provisional/error/gap feedback, receive limits and stale-owner suppression, canonical-only insertion after preview failure, success hiding despite late live words, and cancellation during a delayed overlay send.
- 20 native checks passed; six explicit platform/API helpers remain skipped in the regular suite. Overlay checks cover bounded UTF-16 payloads, fixed enums, unknown fields, inconsistent hidden/off states, and stale owners/revisions. Existing streaming and insertion tests still pass.
- Frontend production build, native debug build, Rust formatting, helper syntax, privacy-scanner regression checks, pattern-only leak audit, and Git whitespace checks passed.

Repeatable commands and the physical-device checklist are in [the README](../README.md). Task 9 is complete within this scope. Next: Task 10, verify the combined single-segment flow with live overlay and canonical insertion.
