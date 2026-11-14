# macOS feature-parity probes

Goal: match every existing Windows feature below, using native Mac conventions.
All three probe groups passed in the packaged app on Apple Silicon by October 29, 2026.

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
- [x] **2 — Insert and restore:** verify every group 2 row in TextEdit, VS Code
  and a browser using disposable text/clipboards.
- [x] **3 — Dictate and recover:** verify every group 3 row, including the full
  recording → live overlay → transcription → cleanup → paste flow and failures.

Mark a group passed only when all its rows and privacy requirements work in the
packaged app. Record gaps rather than passing a subset. Mocks do not prove native
behavior; keep Windows regression and its pending combined manual checks explicit.

## Results

| Probe | Passed | Notes |
| --- | --- | --- |
| 1 — Record and display | October 11, 2026 | Physical shortcuts and rebinding, capture, playback, device loss, permission recovery, and overlay placement and focus on two displays. |
| 2 — Insert and restore | October 13, 2026 | Unicode and multiline paste in TextEdit, VS Code and a browser; refusals on caret, pointer, app or target changes; saved-output retry; rich and multi-item clipboard restore with newer copies preserved. |
| 3 — Dictate and recover | October 29, 2026 | Full pipeline with the window open and closed, each processing option on and off, cancellation, network failure and retry, retained results, key and preference persistence, and app lifecycle. |

Mac capture uses AVAudioEngine rather than WebView capture, which recorded nothing
with the main window closed. A few group 3 failure paths (reconnect gap warning,
live-only failure with full-audio retry, cleanup fallback, stall alerts) run only
shared code and were accepted on their shared, native-transport and rendered tests
rather than repeated in the packaged app. One physical USB unplug under native
capture is still worth a spot check.

Still open: Developer ID release signing, notarization and downloaded-app
acceptance, and the [Windows native regression](verification/windows-regression-verification.md)
after the port. The dated notes written during the probes are in the
[probe log](archive/MACOS_PROBES-log.md); the original pre-port assessment is the
[scope document](archive/MACOS_PORT_SCOPE.md).
