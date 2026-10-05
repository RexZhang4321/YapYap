# UX cleanup verification

Verification date: 2026-10-04

## Automated checks

- All 132 deterministic frontend tests and the TypeScript/Vite production build passed.
- The native build and 25 native tests passed, with seven opt-in tests ignored. An initial linker temporary-file failure was resolved by setting process-local TEMP/TMP to a directory inside the workspace.
- These checks use local fixtures and do not establish the native interaction acceptance below. The final microphone-start completion/error home-state refresh is implemented and builds, but the browser fixture cannot exercise it without Tauri IPC.

UX implementation is complete; native interaction acceptance remains partial and pending. No Milestone 3 processing work is included.

## Actionable recovery follow-up — automated evidence

- The follow-up adds issue-specific home alerts, visible Cancel/Discard during failures and clipboard restoration recovery, processing recovery controls, and exact-text confirmation before copying a bypassed original/provisional snapshot for manual Ctrl+V.
- `npm test` passed all 140 frontend tests. Eight focused tests exercise never-resolving final/cleanup requests, immediate local unlock, late old responses and finalizers during new pending sessions, rejected/stale confirmations without side effects, exact canonical-original cleanup bypass, provisional bypass retaining original retry audio without canonical promotion or paste, finite stage deadlines/uncertain paste, stale microphone startup isolation, and cancellation while the released worklet is still draining. Drain ownership prevents clear/start until the bounded stop completes.
- `npm run build` passed. `cargo test --lib --offline` passed 26 native tests, with seven opt-in tests ignored. The added native test verifies elapsed-budget exhaustion independently of received bytes. The linker needed process-local TEMP/TMP inside ignored `src-tauri/target/build-temp`.
- These are local deterministic/source/build checks. They do not establish real Windows tray/hotkey/microphone/paste behavior or provider responsiveness. No interaction pass is claimed by the implementation agent.

Current cancellation differs from the earlier UX checkpoint: it unlocks the local session immediately instead of waiting for the native request to settle. Stop waiting preserves sources; Cancel/Discard clears them. Native uploads can still finish in the background; a subsequent request receives an actionable busy result and keeps its new recording for retry. Native send/response work has a shared 60-second elapsed budget with separate DNS/connect bounds, and frontend waits are finite (cleanup 30s, transcription 100s, target 5s, insertion 15s). A dispatched paste cannot be retracted and an uncertain result cannot be automatically retried.

## Actionable recovery follow-up — rendered fixture evidence

The GPT-6 Luna verifier loaded the actual application through `scripts/recovery-rendered-fixture.mjs` at localhost:1422 with stubbed IPC and deferred transcription/cleanup responses. No real credentials, microphone, provider requests, clipboard writes, or native pastes were used.

- A stalled cleanup displayed the actionable alert and original-text recovery action. The confirmation showed the exact Unicode original, identified it as the original without cleanup, warned about punctuation/fillers, and initially focused Keep waiting. Rejecting confirmation left cleanup pending with no copy or insertion.
- Accepting cleanup recovery copied exactly the reviewed original through the clipboard stub with backup enabled, stopped waiting, and retained a ready original result. Resolving the old cleanup afterward changed neither the result nor insertion count; no paste was dispatched.
- A stalled final transcription displayed the recording-retry guidance and live-preview recovery action. The confirmation identified the text as provisional and warned about incomplete words, gaps, and recognition errors. Rejecting it left the request/audio untouched. Accepting copied exactly the reviewed preview, stopped waiting, and retained original audio for retry. A late canonical response did not change the stopped session or trigger insertion.
- A rejected transcription showed Dictation needs attention with Discard available. Discard cleared retained audio and the alert, returned the home to Ready to dictate, and allowed a new session.

These checks establish rendered frontend behavior with mocked IPC, not physical Windows behavior. The verifier reached its usage limit before the remaining narrow-dialog checks; no such pass is claimed. Final inspection found no temporary recovery fixture in `desktop/public` and no listener on port 1422.

## Rendered browser fixture

Opened the Vite frontend at `http://localhost:1420/` in the Codex in-app browser. This was a real rendered frontend with no Tauri bridge (`window.__TAURI_INTERNALS__` absent), no IPC shim, and no provider calls. It does not establish native application behavior.

- At the default 1280×720 viewport, the Setup needed home rendered with the shortcut action and one-time API-key setup callout. The accessibility tree exposed labelled Settings and Set up dictation buttons.
- Set up dictation opened Settings and focused `#api-key`. The surface showed “Windows could not read your saved key” because the Tauri storage command was unavailable in this browser fixture. Ordinary Settings opened with `#settings-close` focused.
- Record shortcut entered the capture state and announced “Press Ctrl, Alt, or Windows with another key. Esc cancels.” Pressing Escape returned to “Shortcut unchanged.” This verifies the frontend capture/cancel state only; native registration and conflict handling were not exercised.
- Developer diagnostics used a closed `<details>` element (`open=false`).
- At 380×430, Settings measured 327×390; document/body width was 365px, below the viewport width of 380px. Content scrolled vertically (document height 530px) without horizontal overflow. The home content also fit the 380px width, though the captured viewport remained vertically scrolled after dismissing the dialog, leaving its header above the screenshot.

The home, Settings, and narrow Settings screenshots were captured inline by the browser tool. The tool returned images rather than local file paths, so no screenshot files were saved.

## Native launch and limits

The parent confirmed the native executable built successfully. Test instance PID 18668 stayed responsive and PowerShell reported the title “BYOK Dictation”; however, the computer-use window inventory did not expose it. `sky.list_windows()` omitted the app and `sky.get_window({id: 199372})` reported the window was not found. The requested WebView debugging port 9233 was not listening. Native visual or interaction evidence was therefore unavailable.

No saved API key was entered or modified, no microphone permission prompt was accepted, and no paid provider call was made. The following remain unverified: native tray behavior; actual global shortcut register/save/cancel/conflict and suspension; saved-key and permission readiness/restoration; real microphone recording; Escape cancellation during startup, recording, or processing and while another app has focus; repeated successful dictations and retained-original recovery; failed transcription recovery/copy; and native preference restoration.
