# macOS feature-parity probes

Goal: match every existing Windows feature below, using native Mac conventions.
Baseline: [Windows implementation and behavior](desktop/README.md).

## Feature coverage

| Group | Windows feature | Mac must match |
| --- | --- | --- |
| 1 | Setup/readiness | Settings, key/mic readiness, permission guidance and recovery. |
| 1 | Global shortcuts | Physical hold/release, record/rebind, conflict recovery, Esc/button cancel. |
| 1 | Audio capture | Device selection/refresh, background recording, playback/stop/clear, device-loss recovery. |
| 1 | Floating overlay | Always on top, click-through, no focus theft; target-monitor placement; Listening/Finalizing/Ready/Needs attention; live words, gap warnings, wrapping/autoscroll; hide/clear after success or cancel; reject stale updates. |
| 2 | Guarded insertion | Unicode/multiline paste in native editor, VS Code and browser; recheck destination/caret/pointer, wait for modifiers, refuse changes, prevent duplicates. |
| 2 | Clipboard | Preserve supported formats, restore after paste, preserve newer copies, explicit Copy/Replace/Restore. |
| 2 | Insertion recovery | Choose a new target and retry saved output without provider calls; uncertain paste uses manual recovery. |
| 3 | Live transcription | Live preview on/off, reconnect with gap warning; streaming failure preserves original audio. |
| 3 | Transcript source | Full-audio on uses the recording; off uses completed ungapped live text; failed live-only mode offers full-audio retry. |
| 3 | Cleanup | On/off, punctuation/filler cleanup, preservation guards, separate original/output, original fallback on failure. |
| 3 | Recovery | Retained-audio retry, timeouts/stall alerts, stop-waiting, review/confirm-copy original or provisional words, cancel/discard, ignore late results. |
| 3 | Session results | Previous dictations in memory; view/copy original or output, discard; repeated dictations without mandatory discard. |
| 3 | Credentials/preferences | Secure key save/check/replace/delete; persist shortcut, mic and processing options across restart. |
| 3 | App lifecycle | Close to background, menu-bar Open/Quit, restore hidden/minimized window, single instance; installed launch without dev server. |
| 3 | Timing/diagnostics | Per-stage/total timings, retry timings, first-live-text latency, input meter/metadata, test modes and clearable event log. |
| All | Privacy | Native-only key reads, memory-only audio/text, no secret/dictation logs, clear session data on Quit; overlay cannot invoke privileged commands. |

## Three probes

- [x] **1 — Record and display:** verify every group 1 row with the physical hotkey,
  microphone and floating overlay while another app has focus.
- [ ] **2 — Insert and restore:** verify every group 2 row in TextEdit, VS Code
  and a browser using disposable text/clipboards.
- [ ] **3 — Dictate and recover:** verify every group 3 row, including the full
  recording → live overlay → transcription → cleanup → paste flow and failures.

Mark a group passed only when all its rows and privacy requirements work in the
packaged app. Record gaps rather than passing a subset. Mocks do not prove native
behavior; keep Windows regression and its pending combined manual checks explicit.

## Status — October 11, 2026

Probe 1 passed in the packaged app: physical shortcuts/rebinding, Esc/button
cancel and repeat, 48 kHz capture, playback/stop/clear, device-loss/reconnection,
permission recovery, and overlay placement/focus/click-through on both displays.
Native overlay fixtures confirm all states, gap warning, wrapping/autoscroll and
hide; native/shared checks reject stale updates. Built-in and Elgato playback are
audible at normal speaking distance; no gain processing was added.
Exclusive shortcut conflicts preserve the original binding and recover after
release; shared registrations follow macOS sharing rules. Keychain unlock and
saved-key/preferences access survive restart of the same build; ad-hoc rebuilds
can require fresh Keychain approval. Audio/text remain in memory and overlay IPC
stays restricted. Full pipeline/insertion acceptance belongs to groups 2 and 3.
Automated: 169 frontend, 34 rendered UI, 25 regular native checks; Windows frontend
build passes. Windows retains its original Esc binding and clipboard busy lock.
Groups 2 and 3 remain open.

Keep one short result per group here. Reuse existing controls; remove disposable
fixtures. Implement one group at a time. Future roadmap features are excluded;
broader OS/hardware coverage and trusted signing follow parity.
