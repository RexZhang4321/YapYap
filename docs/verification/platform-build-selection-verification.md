# Build-time platform selection

October 7, 2026; replaces the runtime adapter described in
[the earlier note](platform-adapter-verification.md). Same Mac/toolchain baseline
as MP-00. No new dependency or GitHub Actions workflow was added.

## Final implementation

- Frontend modules import named exports from `#platform`. Vite aliases select
  `platform.windows.ts`, `platform.macos.ts`, or `platform.unsupported.ts`.
  There is no factory, adapter object passed to callers, runtime OS detection,
  metadata validation or capability-query IPC.
- `TAURI_ENV_PLATFORM` supplied by Tauri's build/dev hooks is authoritative.
  Standalone builds support `YAPYAP_BUILD_PLATFORM`, then fall back to the host
  OS. Invalid overrides and conflicting Tauri/override targets fail closed.
- Both main and overlay roots render directly. The platform modules supply
  notices, feature visibility, credential help/errors, microphone help, shortcut
  labels and paste/menu-bar/tray wording. Canonical accelerator tokens stay in
  preferences and native registration.
- TypeScript checks all three module implementations against `platform.d.ts`.
  Node package-import conditions resolve the same source files in unit tests.
  Native `platform/mod.rs` retains only Rust `cfg` selection of insertion code.
  The overlay can read `overlay_snapshot` only; its old metadata read is denied.

## Automated results

- TypeScript and Vite production build passed.
- `npm test`: **169 passed**. Includes authoritative target/host selection,
  conflicting/invalid overrides, all module behaviors and safe error handling,
  Node conditions, and both entry-point production bundle graphs/content.
- Bundle checks prove that Windows imports no Mac/unsupported implementation,
  omits Mac notice/settings/Keychain/fixture markers, and makes no `platform_info`
  request. The Mac bundle omits Windows credential wording and includes its probe
  notice. These are frontend builds, not Windows-native compilation.
- `YAPYAP_UI_CHANNEL=chrome npm run test:ui`: **21 passed**. Windows and Mac
  fixtures use separate Vite builds, ports 1424/1425 and caches. Existing recovery
  regressions and platform-specific visibility/shortcut-persistence checks pass.
- Native Mac tests: **24 passed, 1 provider test ignored**. The runtime capability
  serialization test was removed with that command; overlay authorization remains
  tested. Rust formatting and diff whitespace checks passed.

## Native packaging and acceptance

The Mac app/DMG build passed through `npm run build:macos -- --ci -- --locked
--offline` using MP-00's isolated Cargo cache and `CI=true`. Tauri's hook selected
the Mac module automatically; no manual frontend platform override was used.

The actual packaged main WKWebView loaded `tauri://localhost`, showed
Control/Option labels, the Mac notice and menu-bar wording, and kept credential
entry disabled. Settings showed the formatted shortcut. The actual second
WKWebView rendered Listening/Provisional and the fixed Unicode fixture. Quit
and relaunch cleared that fixture; the updated main window was left open.
These were direct native UI observations, with no recordings, microphone grants,
provider calls or user clipboard mutations. The local ad-hoc bundle signature
verified successfully. Trusted signing/notarization remains unverified.

DMG SHA-256:
`eb1284b7e854d4f62e56bcdb868d08c73249ecbeaa89c5e5a3e86230f6902871`.

Windows native, physical microphone/global-hotkey, safe insertion, Keychain,
provider and trusted distribution acceptance remain the existing probe gaps.
