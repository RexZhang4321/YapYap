# YapYap desktop app

Developer notes for the Tauri app. For an overview, install steps and project status, start with the [project README](../README.md). For how to use the app, see the [user guide](../docs/USER_GUIDE.md).

YapYap's npm and Rust packages are `yapyap`, its native library is `yapyap_lib`, and its Windows executable is `yapyap.exe`. Install the generated `YapYap_0.1.0_x64-setup.exe` and launch **YapYap** from Start. If upgrading from BYOK Dictation, follow the [upgrade instructions](RELEASE.md#upgrading-from-byok-dictation); you will save your API key and choose preferences again.

For the Windows installer, required permissions, release checks and signing workflow, see [Windows release guide](RELEASE.md). Run `npm.cmd run release:windows` for an unsigned local test installer; installed-app acceptance and trusted signing remain separate release gates.

Run `npm install` and `npm run tauri dev` from this directory. The normal flow is **hold shortcut → speak → release → insert**; the app stays available in the system tray when its window closes.

## macOS

The Mac build runs on Apple Silicon. All three parity probe groups (recording and
overlay, insertion and clipboard, pipeline and recovery) passed in the packaged
app; Developer ID signing, notarization and downloaded-app acceptance are pending.
See the [Mac checklist](../docs/MACOS_PROBES.md) and historical
[MP-00 evidence](../docs/archive/verification/macos-mp-00-verification.md).

Install Node, Rust and Xcode tools, then run from `desktop/`:

```sh
npm ci
npm run dev:macos
# Quit the development app before launching a packaged build.
npm run build:macos -- --ci
```

For probing, run `npm run install:macos` instead of copying builds around. It
builds the app, quits any running YapYap, replaces `/Applications/YapYap.app`,
verifies the signature and launches it, so Accessibility, Microphone and
Keychain always refer to one copy. It signs with `YAPYAP_SIGNING_IDENTITY`,
else a valid Developer ID Application, else Apple Development identity, so
grants survive rebuilds; with no
valid identity it falls back to ad-hoc signing, which macOS treats as a new
app after every rebuild. `--skip-build` installs the existing build and
`--no-launch` leaves it closed.

The local app and DMG are in `src-tauri/target/release/bundle/macos/` and
`src-tauri/target/release/bundle/dmg/`. These use ad-hoc signing for local probes;
Developer ID signing, notarization and downloaded-app acceptance are pending.
Microphone and physical-shortcut acceptance are separate probes.

## Native development

To launch the native client from the repository root, run `cd desktop`, then `npm run tauri -- dev`. Tauri starts Vite automatically; do not start a separate `npm run dev` first. If startup reports **Port 1420 is already in use**, stop the earlier Vite/Tauri terminal with Ctrl+C and retry. `npm run dev` alone is only the browser frontend and does not provide native dictation capabilities.

Opening the native app again restores and focuses its existing window, including when it is minimized or hidden in the tray. Closing the main window keeps dictation active; use the tray's **Quit** command to exit. Quit before switching between an installed build and a development build, which share the same app identity. The browser recovery fixture has a separate Vite dependency cache, so its tests can run alongside the native development client without invalidating the floating overlay's modules.

## Frontend development

Platform differences are selected at build time. Frontend code imports ordinary
named exports from `#platform`, for example:

```ts
import { formatShortcut, pasteShortcut, showOverlayFixture } from "#platform";
```

`platform.config.mjs` configures Vite to resolve that import to
`src/platform/platform.windows.ts`, `platform.macos.ts`, or
`platform.unsupported.ts`. Tauri's `TAURI_ENV_PLATFORM` chooses the target during
native builds; the build machine's OS is only a fallback for standalone Vite.
There is no runtime platform detection, adapter object or capability-query IPC.
Both entry points render immediately. TypeScript checks every implementation
against the named-export contract in `src/platform/platform.d.ts`.

For frontend-only builds or browser development, an explicit selection is useful:

```sh
YAPYAP_BUILD_PLATFORM=windows npm run build
YAPYAP_BUILD_PLATFORM=macos npm run dev
```

An override that conflicts with Tauri's target is rejected. Vite dependency
caches are isolated by platform. These frontend builds do not cross-compile the
native executable. Node's package-import conditions select the same modules for
unbundled tests; `npm test` uses the Windows condition for the shared regressions
and also verifies the other module selections and production bundle contents.

The Mac module exposes the probe notice and overlay fixture controls; Windows
omits them. Displayed Command/Option/Windows labels are presentation: preferences
and shortcut registration retain canonical `Ctrl`/`Alt`/`Super` accelerators.
Future features should add named exports to the contract and each implementation,
with native support verified before enabling their build-specific UI flags.
Rust retains compile-time backend selection in `src-tauri/src/platform/mod.rs`;
native command authorization remains independent of frontend flags.

Both windows use React 19 and TypeScript, built with Vite. `index.html` and `overlay.html` mount separate React roots; their existing CSS and native Tauri capabilities remain in place.

- `src/ui/App.tsx` composes the main window and owns Settings navigation and native dialog refs.
- `src/ui/Home.tsx`, `SettingsContent.tsx`, `ApiKeySettings.tsx`, `SessionRecovery.tsx`, and `RetainedList.tsx` contain the feature components. Retained rows use session IDs as React keys to preserve expansion and focus during updates.
- `src/ui/store.ts` exposes cached view snapshots through React's `useSyncExternalStore`; `View.tsx` binds typed HTML props, controlled inputs, status text, and controller actions. Initial display values live in `initialState.ts`. Add new UI features in these components, using local React state for presentation and extending the store only when session logic needs to publish a value.
- `src/dictationController.ts` owns the application session for the lifetime of the WebView. React renders its state; component renders and refreshes do not register another global shortcut or start another recorder. Native refs are used for playback, modal dialogs, and focus. The recording, transport, transcription, and recovery modules retain their existing responsibilities.
- `src/overlay.tsx` renders the passive overlay and disposes its event subscription on unmount. Revision checks, provisional-text separation, and scrolling to the latest words remain in place.

API-key drafts stay in an uncontrolled password input and are cleared synchronously before IPC. They never enter shared view snapshots or persisted preferences.

Use `npm run dev` for browser development, `npm run build` for TypeScript checking and both production entry points, and `npm test` for the session and view-store regressions. `npm run test:ui` runs the rendered React checks using installed Google Chrome and a local fixture server on port 1424. These checks stub credentials, microphone, provider, clipboard, shortcuts, and insertion; they make no provider requests or native paste operations. Windows tray, physical-microphone, focus preservation, and real insertion acceptance still require the native checks below. `npm run format:ui` formats the React UI sources.

The rendered suite uses separately compiled Windows/Mac fixtures on ports
1424/1425 with independent Vite aliases and caches. Set `YAPYAP_UI_CHANNEL`
to choose another Playwright browser channel. These platform builds prove view
behavior, not native Windows execution or physical Mac input.

## Developer diagnostics and verification

Run `npm run test:group3` for the deterministic Group 3 session tests under
both platform selections, the host's native tests, rendered Windows and Mac
fixture checks, and the pattern-only key audit with its scanner tests. Add
`-- --quick` to run only the session and native tests. Native tests use the
locked Cargo dependencies offline and local loopback peers. These checks use
fixtures, make no provider requests, and
do not establish packaged microphone, OS shortcut, or external paste behavior.
Add `-- --native-probes` to also exercise the host's credential store with a
disposable item and the HTTPS client against OpenAI with an invalid fixture
key; these read no saved key and make no billable request. On Mac it also
records from the default microphone through a disposable aggregate device,
selects it by name, unplugs it mid-capture and checks that capture ends,
flushes and restarts; the terminal needs microphone permission.

Open **Settings → Developer diagnostics** for the optional live/transcription and insertion test modes, microphone level/metadata, latency, and fixed event logs. This area is closed by default. Leave **Shortcut test mode** on **Dictate and insert** for normal use; live test mode intentionally retains audio and does not insert on release.

The main window shows **Processing time** after release: audio preparation, final transcription request, cleanup request, destination check, paste/clipboard restoration, and total elapsed time after release. Running durations refresh every 250 ms; completed values remain until the next dictation or discard. Disabled or unreached stages show Skipped; failures and stopped waits keep their elapsed durations. Explicit retries show their own attempt totals. Request timings cover the frontend/native round trip, upload, provider processing, response reading and validation; they do not separate network time from model time. Timings use a monotonic clock and remain in memory only. They are not exported as telemetry or retained with earlier transcript results.

Regular checks are `npm test`, `npm run build`, and, from `src-tauri/`, `cargo test --lib --offline` plus `cargo fmt --check`. Regular tests use local fixtures and make no provider requests. Real-provider checks are opt-in (`cargo test -- --ignored`) and may incur API usage. Native tray, microphone, global-shortcut and paste behavior is not covered by these suites; it is checked manually against the [Windows regression checklist](../docs/verification/windows-regression-verification.md) and the [macOS probes](../docs/MACOS_PROBES.md).

The per-task implementation and manual-check notes that used to follow here are in the [archived probe notes](../docs/archive/desktop-probe-notes.md).

## macOS insertion and clipboard notes

Settings → Developer diagnostics → **Text insertion test** uses the configured
hold/release shortcut and a fixed Unicode, multiline sample. Focus a disposable
TextEdit document, VS Code Untitled editor, or browser text field before holding
and releasing it. Allow **YapYap** in **System Settings → Privacy & Security →
Accessibility** first; denied access refuses paste without changing the clipboard.
A rebuilt ad-hoc app may need approval again. If Accessibility is already enabled
but insertion still reports denied access, quit YapYap, remove its existing entry
from the Accessibility list, add the current packaged `YapYap.app` again, enable
it, and relaunch that exact app. macOS may require Touch ID or your login password
for the permission change. The current probe bundle is at
`src-tauri/target/release/bundle/macos/YapYap.app`; avoid rebuilding between granting
access and completing acceptance. Check the actual running bundle rather than
assuming another app with the same display name is the granted build.

The probe config uses ad-hoc signing (`signingIdentity: "-"`). Its designated
requirement identifies an exact binary, so rebuilding can change the permission
identity even with the same bundle identifier/path. See [Apple's code-signing
requirements](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html).
Stable permission identity across updates requires consistent certificate signing;
this is part of the trusted-distribution work after parity.

VS Code may need its screen reader
accessibility support enabled so it exposes the editor's text selection.

The Mac adapter captures the foreground application's Accessibility window/input,
selection offsets and pointer position, waits up to 1.5 seconds for modifiers,
then rechecks before sending Command+V. Missing selection information, a changed
window/input/caret/pointer, a closed target or held modifiers refuses insertion.
Only selection offsets and element identities are read; destination text and
window titles are not read. Like Windows, a switch away and back between checks
cannot be proven, and sending paste events does not prove the target accepted them.

NSPasteboard backups retain each item's data formats in memory, including rich
text, images and file URLs when readable. Unreadable data, promised files, more
than 128 items/formats, or more than 64 MiB refuses automatic paste and safe Copy.
**Copy test text** saves a backup; **Copy without backup** explicitly replaces
unsupported content. **Restore previous clipboard** explicitly restores the
backup, replacing the current contents. Automatic restoration waits 250 ms after
paste, checks the change count and our text, and preserves a newer copy.
NSPasteboard provides no system-wide clipboard lock or atomic conditional write;
the adapter checks ownership immediately before mutations and serializes its own
operations. Saved-output retries use the existing session recovery flow, capture
a newly chosen target and never request another transcription or cleanup. A paste
that may already have been sent permits manual recovery only.

Native adapters are selected at compile time. Mac AppKit/Accessibility/CGEvent
code stays in `src-tauri/src/platform/insertion_macos.rs`; Windows uses
`src-tauri/src/platform/insertion_windows.rs`. See [probe status](../docs/MACOS_PROBES.md) for the
observed packaged acceptance and remaining checks.
