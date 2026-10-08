# Platform adapter verification

Historical runtime-adapter evidence. Superseded by
[build-time platform selection](platform-build-selection-verification.md).

October 7, 2026; working-tree follow-up to [MP-00](macos-mp-00-verification.md).
Same Apple Silicon/macOS/toolchain baseline. No provider requests, microphone
permission grants, recordings or user clipboard changes occurred.

## Adapter contract

- Rust `platform/mod.rs` owns insertion backend selection and the `platform_info`
  metadata command. Windows selects its unchanged Win32 implementation; other
  platforms select the refusing shell. Capability flags describe implemented
  credential storage, provider requests, insertion, clipboard and overlay fixture.
- `src/platform.ts` validates metadata, freezes the adapter and initializes once
  before each React root mounts. Failure, missing fields, nonboolean fields and
  inherited capability fields enable no capabilities. A later native capability
  can enable its UI without introducing OS checks in individual views.
- Windows omits the Mac fixture controls, uses Credential Manager/Ctrl+V/tray
  copy and preserves credential setup. Mac shows its probe notice, disables key
  entry, exposes overlay fixtures and uses Keychain/Command/Option/menu-bar copy.
  Keychain wording anticipates a future storage adapter; no Mac storage was added.
- Shortcut labels are formatted only for display. Persisted preferences and
  plugin registration continue to use canonical `Ctrl`/`Alt`/`Super` tokens;
  submitting a read-only formatted shortcut cannot save its display aliases.
- Overlay IPC permits `overlay_snapshot` and `platform_info` reads only. Neither
  metadata nor UI flags authorize native actions. Unknown WebViews are rejected.

## Automated verification

- `npm test`: **169 passed**. Includes runtime initialization, metadata validation,
  safe error mapping and Windows/Mac presentation tests.
- `YAPYAP_UI_CHANNEL=chrome npm run test:ui`: **21 passed**, using mocked native
  capabilities on this Mac. Added Windows hidden-control/credential checks and
  Mac label/disabled-key/overlay/shortcut-persistence checks. All existing
  recovery and rendering regressions also passed.
- `cargo test --lib --locked --offline` with MP-00's isolated Cargo cache:
  **25 passed, 1 opt-in provider test ignored**. Added capability serialization
  and overlay authorization boundary tests.
- TypeScript/Vite production build, Rust formatting and diff whitespace checks
  passed. Ad-hoc signed app/DMG packaging passed using MP-00's command with
  `CI=true`; signing is for local testing, not trusted distribution.

## Native observation and remaining limits

The actual packaged main WKWebView loaded `tauri://localhost` and showed
`Control+Option+F8`, a capability-specific Mac notice, menu-bar footer wording,
and disabled native credential controls. Settings also showed the formatted
shortcut and Mac permission/menu-bar help. This verifies real native metadata
resolution for the main entry point. After packaging, the actual second
WKWebView rendered Listening/Provisional with the fixed Unicode fixture, and
quitting/relaunching cleared it. The updated main window was left open.
The generated app remains under
`src-tauri/target/release/bundle/macos/YapYap.app`.

Final follow-up DMG SHA-256:
`7ec83cbd7c66c9f1f79870bca74f71ed5e6ed615ebeecfdaf871c775040a0257`.

Windows UI fixtures do not establish Windows native build/paste/tray acceptance.
Existing MP-01 through MP-10 gaps remain open; no native Keychain, HTTP, clipboard
or Accessibility adapter was implemented in this refactor. Signing/notarization,
hardware and installed-app acceptance remain outside these checks.
