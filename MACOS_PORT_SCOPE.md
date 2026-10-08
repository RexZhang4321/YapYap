# macOS port scope

Assessment: October 6, 2026; source commit `161f413`.

Next: [ordered gap probes and decision gates](MACOS_PROBES.md). The full probe
checklist includes failure and release checks beyond the initial feasibility spike.

YapYap can keep its Tauri 2 / Rust / React architecture. The port is primarily
native integration plus platform acceptance work. A UI rewrite is unnecessary.
This is a source assessment, not a verified macOS build: this checkout has no
installed npm dependencies or Rust build outputs, and Cargo was unavailable on
the inspected shell PATH. No application code was changed or provider requests
made during this assessment.

## Proposed first-release boundary

Target Apple Silicon first, distribute a signed and notarized `.app` in a DMG,
and support the existing single-recording dictation experience: configurable
hold-to-talk, local microphone capture, live overlay, final transcription,
optional cleanup, guarded insertion, and recovery. These are proposed scope
assumptions, not previously approved product decisions.

Choose the minimum supported macOS version after the microphone/permission
probe, then test that version and the current release. Treat Intel support,
Mac App Store distribution, an Fn-only shortcut, login launch, and an updater
as separate additions. The current app has no updater or login-launch feature.
VAD, incremental canonical transcription, vocabulary, and new providers are
existing product roadmap work rather than requirements for this port.

## Repository findings and required work

| Area | Evidence in this checkout | macOS work |
| --- | --- | --- |
| Build | `desktop/src-tauri/src/lib.rs` unconditionally includes `insertion`; that module links `user32`/`kernel32` and calls Windows-only `window.hwnd()` methods. `tauri.conf.json` bundles NSIS only. | Split Windows insertion implementation behind target configuration; add a Mac implementation and Mac bundle configuration. Compile using the locked dependencies on a Mac. |
| Shared application | React views, session model, recovery, WAV encoding, PCM resampling, live protocol, and parsers are largely platform independent. | Keep these components; change platform wording/defaults and connect native implementations through the existing IPC contract. |
| Credentials | `credentials.rs:159` returns `credential_platform_unsupported` on every non-Windows credential operation. | Implement Keychain read/write/delete/presence with stable service/account names. Preserve native-only secret access, fixed errors, and zeroized owned buffers. Test locked/denied access and signed upgrades. |
| HTTPS | `openai.rs` uses WinHTTP. `transcription.rs:17` and `cleanup.rs:18` explicitly compile their provider calls only on Windows. | Add a Mac HTTP implementation behind the existing request seam and enable the provider calls on Mac. Preserve fixed provider host, certificate verification, no redirects, bounded response size/deadline, sensitive headers, and sanitized errors. A Rust HTTP client is a reasonable candidate; retaining WinHTTP on Windows limits regression scope. |
| Live transport | `streaming.rs` uses Tokio/Tungstenite/native-tls without a Windows-only transport guard, but reads the Windows-only credentials. | Reuse after Keychain integration; verify Mac TLS trust, connect/cancel behavior, and network failures. |
| Microphone | `audioCapture.ts` uses `getUserMedia`, `AudioContext`, and `AudioWorklet`; the current native helpers assume WebView2. | Add microphone usage text and audio-input entitlement. Prove device selection, worklet module loading, nonzero PCM, flush, and background capture in WKWebView, both in development and the installed bundle. Budget a native capture fallback only if this fails. |
| Shortcuts | Existing Tauri global-shortcut plugin and capability already include macOS. `shortcuts.ts` handles `metaKey` as `Super`; UI text/defaults are Windows-specific. | Keep the plugin initially. Verify physical press/release, alternate modifier-release order, repeat, conflicts, Escape registration, sleep/wake, and permission interactions. Render Command/Option names and select a tested Mac default. |
| Destination and paste | The 858-line `insertion.rs` combines target capture, pointer/caret checks, modifier release, clipboard backup, paste, and duplicate prevention with Win32 APIs. | Implement focused application/window/element capture through macOS Accessibility APIs, revalidate before paste, and send Command+V through native event APIs. Preserve session IDs and refusal/uncertain/attempted outcomes. |
| Clipboard | Backup is Windows-format/global-memory specific; automatic restore uses a clipboard sequence number and contents check. | Implement multi-item/type snapshot and restore with `NSPasteboard`. Use `changeCount` plus our-text verification to preserve newer copies. Handle denied reads, unavailable/lazy data, files/images/rich text, size limits, and explicit replacement recovery. A text-only clipboard plugin does not provide this behavior by itself. |
| Overlay | Windows explicitly shows without activation and positions on the foreground app's monitor. Non-Windows falls back to `current_monitor()` and normal `show()`. | Verify nonactivation and mouse-through behavior; use target display placement, and test Retina scaling, multiple monitors, Spaces and full-screen apps. Add an AppKit-specific window/panel adapter if Tauri flags are insufficient. |
| App lifecycle | Tauri tray, hide-on-close and single-instance behavior already exist. | Verify menu bar icon, Quit, Dock reopen, hidden/minimized relaunch, and a usable Mac application menu. Decide Dock visibility deliberately. |
| Tests/release | Playwright selects Edge; native fixtures use PowerShell, WinForms and WebView2 CDP. Saved-key/profile leak audit flags require Windows. No CI workflow was found. An `.icns` icon already exists. | Parameterize browser tests and add a WebKit renderer pass; build Mac native fixtures and acceptance procedures; extend credential/profile audit. Add Mac build/release checks and rerun Windows checks after refactoring. |

### The main engineering risk: safe insertion

App identity alone is insufficient: the user may move the cursor within the same
application while transcription is pending. Capture the focused accessibility
element and available selection/caret metadata, then compare at completion.
Some applications do not expose enough information. Define a conservative
support policy: retain the transcript and offer Copy when the destination cannot
be validated; never force-focus an old application or blindly paste into the
current one. Pointer comparison can be an additional guard but cannot establish
that a text selection is unchanged.

Keep the existing distinction between refusing before dispatch and uncertainty
after dispatch. Native event posting is not proof that the application consumed
the paste. The existing 250 ms clipboard restore delay needs measurement on Mac
targets; do not assume it is safe for every application. Bound Accessibility
queries and schedule AppKit work on its required thread so target probing cannot
freeze recording or cancellation. Inspect only the metadata needed for local
insertion; do not collect target document text or send it to the provider.

### Permission onboarding is part of the product

Provide readiness and recovery for microphone permission and Accessibility/event
posting access. Check the chosen shortcut implementation before adding Input
Monitoring; do not assume every global shortcut requires it. No screen capture
permission is implied by this design. Test denied and revoked permission, not
just the first successful grant. Newer macOS pasteboard access controls also
need coverage because preserving the user's clipboard requires reading it.
Use OS prompts and version-appropriate help rather than hardcoding one settings
label across all supported releases.

## Delivery sequence and effort

These are engineering estimates for one developer familiar with Rust/Tauri,
with a Mac and timely access to signing credentials. They include integration
and QA; they are not measured implementation results or delivery commitments.

| Milestone | Exit condition | Cumulative effort |
| --- | --- | --- |
| Feasibility spike | Mac shell compiles after isolating Win32 code; physical hotkey press/release works; a packaged app captures nonzero microphone PCM; overlay preserves focus; fixed fixture text pastes into TextEdit and a browser field with basic clipboard restoration. | 2–3 working days |
| Personal-use alpha | Keychain, HTTPS, live streaming, full dictation, Copy/retry/cancel and permission UI work on an Apple Silicon Mac. Test at least one native editor and one browser. | 6–10 working days |
| Distributable beta | Broader destination/clipboard matrix, lifecycle and display tests, signed/notarized DMG, clean install and upgrade checks, leak audit and Windows regression checks pass. | 15–25 working days, approximately 3–5 weeks |

If WKWebView capture requires a native capture implementation, reserve another
3–5 working days for integration and verification. Intel support needs a second
architecture build plus actual Intel hardware acceptance; provisionally allow
2–4 additional days once hardware is available. A new low-level hotkey backend
or broad compatibility with apps that expose poor Accessibility metadata needs
re-estimation after the spike. App Store distribution needs a separate sandbox
and review assessment; it is not just a packaging switch. Signing-account setup
and external service turnaround may add calendar time.

## Acceptance gates

- Installed app works without a Vite server, stores the key across restart, and
  supports permission grant, denial, revocation and recovery.
- Physical built-in/USB/Bluetooth microphone checks cover startup, device loss,
  background recording, original PCM retention, cancellation and sleep/wake.
- Hold/release works while another application is focused, including early
  release while microphone permission/startup is pending.
- Full live/final/cleanup pipeline uses the existing source-of-truth and recovery
  behavior. Provider checks use explicit opt-in fixtures and avoid secret logs.
- Destination matrix covers TextEdit, Safari, a Chromium browser, VS Code and a
  representative chat application. Secure fields and unsupported/closed targets
  refuse safely. Switching app/input or moving the selection retains the result.
- Test empty/text/rich/image/file clipboards, multiple items, denied clipboard
  access, concurrent user copies, slow paste consumers and failed restoration.
  Do not automatically repeat an uncertain paste.
- Overlay never steals focus and behaves predictably on multiple displays,
  Retina scaling, Spaces and full-screen windows. Hidden/reloaded overlays cannot
  display discarded text or gain main-window IPC privileges.
- Menu bar/Dock/relaunch/Quit checks pass. A browser-downloaded signed artifact
  passes signature, notarization/stapling and clean-machine Gatekeeper checks;
  an upgrade preserves preferences, key access and usable permissions.
- Frontend tests/build, Rust tests/formatting, Mac native acceptance and Windows
  regression checks pass. Existing Windows Task 10 notes still describe an
  incomplete combined native flow check; those notes are not proof of Mac parity.

Browser fixtures can validate rendering and logic but do not prove WKWebView
microphone, OS shortcuts, or external-app paste. Existing CDP helpers cannot be
assumed to control WKWebView. Tauri's current documentation offers embedded
WebDriver through WebdriverIO for Mac app UI automation; evaluate compatibility
with the lockfile before adopting it and keep test control out of release builds.
External target and physical-device acceptance still need native/manual checks.

## Platform references checked

- [Tauri global shortcuts](https://v2.tauri.app/plugin/global-shortcut/): Mac support and pressed/released events.
- [Tauri Mac bundles](https://v2.tauri.app/distribute/macos-application-bundle/): Info.plist merging, usage description and bundle configuration.
- [Apple audio-input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input).
- [Wry microphone permission tracking](https://github.com/tauri-apps/wry/issues/1195): historical WKWebView permission problems justify probing; this is not evidence that the locked version is broken.
- [Apple Keychain services](https://developer.apple.com/documentation/security/keychain-services).
- [Apple Accessibility trust check](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions).
- [Apple event-posting access check](https://developer.apple.com/documentation/coregraphics/cgpreflightposteventaccess()).
- [Apple pasteboard change count](https://developer.apple.com/documentation/appkit/nspasteboard/changecount) and [access behavior](https://developer.apple.com/documentation/appkit/nspasteboard/accessbehavior-swift.enum).
- [Tauri signing/notarization](https://v2.tauri.app/distribute/sign/macos/) and [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
- [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/).
