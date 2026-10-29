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
- [x] **2 — Insert and restore:** verify every group 2 row in TextEdit, VS Code
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
Group 2 passed on October 13; group 3 remains open.

Keep one short result per group here. Reuse existing controls; remove disposable
fixtures. Implement one group at a time. Future roadmap features are excluded;
broader OS/hardware coverage and trusted signing follow parity.

Probe 2 — October 13: passed in the unchanged packaged app. Unicode/multiline
paste works in TextEdit, VS Code and a browser. Caret/pointer movement, app
switching, target closure and a three-second held modifier refuse paste. Retained
output retries in a new editor without transcription/cleanup (0.29 s). Packaged
Copy/Restore preserves rich/custom formats and multiple items; safe Copy refuses
promised files without mutation, while explicit Replace succeeds without backup.
The final physical two-paste check restored every rich/custom format and both
items, then preserved a newer copy made during the second paste. The user saw the
sample both times; native diagnostics confirm both outcomes. The observer restored
the original clipboard and disposable fixtures were removed. Refreshing only the
stale Accessibility entry fixed this ad-hoc build's permission mismatch. Mac code
is isolated by compile-time platform selection; the Windows native adapter is
unchanged. Automated: 169 frontend, 34 rendered UI and 29 native checks; Windows
frontend build, Mac signature and DMG integrity pass. Windows native regression
and combined manual acceptance remain pending. Group 3 remains open.


Transport update — October 28: full-audio transcription, cleanup and connection
checking use the same cross-platform HTTPS client on Mac and Windows. Focused
local HTTP tests and invalid-key OpenAI checks pass on Mac; these do not establish
a successful saved-key request or packaged pipeline acceptance. Probe 3 remains
open; Windows native transport regression remains pending.

Probe 3 — October 28, in progress: the isolated ad-hoc packaged candidate passed
signature verification and, after Keychain unlock, its OpenAI connection check.
`npm run test:group3 -- --ui --privacy` adds repeatable shared/native fixture,
rendered Mac/Windows and pattern-only privacy checks; these do not prove native
paste or a successful transcription. Standalone saved-key live and cleanup tests
were denied Keychain access. A physical dictation produced an empty transcription;
the user reported unusually quiet playback. Microphone input level is under
investigation: normal speech was reported below 1% RMS at the original macOS
input setting, and about 1% after raising it; playback was intelligible at
60–80% output volume. At the higher input setting, live words appeared but a
full-audio attempt again returned empty; a later attempt produced a transcript
and cleanup, but destination capture failed and saved-output recovery is pending.
A retained 3.5 s recording measured 0.02% RMS (0.4% peak). Full-audio uploads now
apply shared peak-limited gain toward 5% RMS (at most 256×); the retained and
downloaded WAV stay unmodified. The rebuilt packaged app's bundle contains the
gain on the upload path, and its first physical full-audio dictation produced a
transcript. Capture level remains near the gain cap; Windows has the shared gain
but is untested. Saved-output recovery and the remaining group 3 rows are open.
Windows native regression remains pending.

Probe 3 — October 29, in progress: `npm run install:macos` now installs the single
Developer ID–signed `/Applications/YapYap.app` (`com.jingxuan-zhang.yapyap`), so
privacy grants survive rebuilds. With the main window closed, WebKit capture
recorded nothing (zero AudioWorklet callbacks); `backgroundThrottling` did not
help. Mac capture now uses AVAudioEngine behind the shared recorder contract:
hidden-window dictation records and inserts, and speech measured 5.6% RMS versus
0.02–0.03% through WebKit. The shared upload gain was removed: it no longer
applied to Mac speech, Windows never needed it, and boosting near-silent
recordings risks transcribing amplified noise. Passed in the
packaged app, window open and closed: live words on/off, full-audio and live-only
sources, cleanup on/off with separate originals, direct paste and shortcut retry
of saved output (0.29 s, no provider calls), Esc cancel during finalizing with
late results ignored, network failure keeping the recording and live words,
confirmed copy of provisional words, retry after reconnecting, five retained
results with copy/discard, connection check, key and preference persistence
across Quit, close to background, menu-bar Open/Quit, minimize restore, single
instance, and Dock reopen (fixed). The overlay updated while hidden; macOS logs
and app data held no dictated text or key. A long-running process once reported
unreadable clipboard data that a fresh process read normally; the Mac message
now names the format, matching Windows. Not yet seen on Mac: the manual Reconnect
preview gap warning, a stall alert under a slow (not refused) connection with
Stop waiting, live-only failure offering full-audio retry, cleanup failure
fallback, and key replace/delete through the UI (covered by shared tests and the
disposable Keychain probe). Destination capture refusals now show the native
reason in the alert. Group 3 remains open; Windows native regression remains
pending.
