# React frontend migration

The main window and passive overlay now render with React 19 and TypeScript. The existing stylesheet, screen content, native dialog semantics, control IDs, and Tauri window capabilities are retained. Components are grouped under `src/ui`; the WebView session controller publishes view state instead of mutating HTML. Recording, transport, transcription, insertion, and recovery remain in their existing domain modules. The password draft is excluded from shared snapshots.

Validation performed:

- `npm run build`: TypeScript checking and both production entry points pass.
- `npm test`: all 144 checks pass, including four new view-store regressions for snapshot stability, batched notifications, exact modal review text, retained results, and disposed action bindings.
- `npm run test:ui`: eight rendered Microsoft Edge checks pass. They cover Settings focus, controlled preferences and restart persistence, shortcut recording and Escape, 380 × 430 layout, secret clearing and active-session locking, rejected and confirmed recovery copies, late cleanup suppression, provisional/audio separation, failed-session discard, retained-row expansion/focus/discard, and overlay literal-text rendering, tail scrolling, stale-revision rejection, and clearing.
- `git diff --check`: passes.

The browser fixture stubs microphone, credentials, provider calls, clipboard, native shortcut registration, and insertion. These checks make no provider requests and do not paste into another application. They do not replace the outstanding native tray/hotkey, physical-microphone, foreground-window, or real-insertion acceptance checks documented in `ux-verification.md`. The Rust implementation and window capabilities were not changed by this migration.

Existing Task 6–10 WebView helpers now write fixture values to the React view store and continue observing rendered DOM; they no longer rely on DOM assignment to change application state. Those native integration helpers were updated but were not rerun in this migration.

## Blank native overlay follow-up

An isolated Windows client reproduced a white floating panel with an empty React root and no applied stylesheet. Its overlay-only `@tauri-apps/api/event` module returned `504 Outdated Optimize Dep`. The browser fixture and native dev server used the same default dependency cache; the fixture's optimizer could invalidate modules still referenced by the running native windows.

The fixture now has its own `node_modules/.vite-recovery-fixture` cache, and the native Vite server explicitly scans both HTML entry points. A concurrent-server regression verifies that the original event-module URL remains valid while the fixture starts, runs, and stops. All 145 automated checks, eight browser checks, and the production build pass.

After the browser suite ran alongside the native client, an isolated real WebView2 instance successfully rendered fixed Unicode text in the floating overlay through native `claim_overlay`/`update_overlay` IPC. Recording, processing, error, hide, and show-again transitions rendered correctly and hiding cleared the DOM text. The isolated test used an independent WebView profile and was closed afterward. No microphone permission prompt was accepted, no provider request was made, and no paste was dispatched. These observations cover native overlay rendering, not the complete microphone-to-insertion flow.

## Explicit insertion retry follow-up

Shortcut retry previously reused the original captured destination, so recovering in a different input could be refused repeatedly. After a confirmed pre-paste refusal or a failed destination capture, pressing and releasing the shortcut now captures the currently focused input and inserts the saved output there. Native focus/cursor/clipboard preflight remains in place. Transcription and cleanup are not repeated; uncertain or partially dispatched pastes remain ineligible for shortcut retry. The main alert displays the native refusal reason, and retry statuses describe choosing a destination/pasting rather than microphone recording.

All 147 deterministic checks, ten rendered Edge checks, and the production build pass. Added regressions cover recapturing a different target, capture failure/timeout/cancellation, concurrent retries, preserving cleaned output, displaying the refusal reason, repeated shortcut events, and preventing retry after an uncertain paste. Rendered checks mock native capture/insertion. The user's running native window was not exposed in the computer-use window inventory; this follow-up does not claim a new physical Windows paste acceptance pass or establish the exact reason for the user's initial refusal.
