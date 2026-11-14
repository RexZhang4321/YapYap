# MP-00 initial build evidence

October 7, 2026. Status: **MP-00 passed** on the available Apple Silicon Mac.
Base revision: `c7bdeeccf1ccffd0a354f8d47744bf2a7aeecb5e` plus working-tree changes.
Host: macOS 26.6.2 (25G83), arm64. Node 22.14.0, npm 11.14.0,
Xcode 27.0 (27A266a), SDK 27.0. No Intel or older macOS coverage.

Rust was initially absent. Installed stable Rust/Cargo 1.99.0 and rustfmt
1.10.0 in the standard user account through rustup; verified from a fresh login
shell. An existing terminal can use `source "$HOME/.cargo/env"`.
The first compile used isolated toolchain/cache directories in `/private/tmp`.

## Observed automated results

- Locked `npm ci` succeeded without a dependency upgrade.
- Original `cargo test --lib --locked --no-run` failed with six E0599 errors:
  `WebviewWindow::hwnd()` is unavailable on macOS, at insertion.rs lines
  608, 641, 666, 697, 724 and 747. The unguarded Win32 module also declares
  user32/kernel32 links; compilation stopped before linking.
- After platform selection: native tests **23 passed, 1 opt-in provider test
  ignored**. Windows insertion tests are platform-specific and were not run.
- Frontend tests: **165 passed**. A fresh-checkout fixture assumed Cargo's target
  directory existed; added recursive directory creation. The fixture server
  needed execution outside the sandbox to bind localhost.
- TypeScript and Vite production build passed, including index.html and
  overlay.html. Rust formatting, diff whitespace and source plist lint passed.
- App and DMG packaging passed. `codesign --verify --deep --strict` passed, and
  signature entitlements include `com.apple.security.device.audio-input = true`.
- The bundle contains the unchanged identifier, microphone usage description and
  an arm64 executable. Its default `LSMinimumSystemVersion` is 10.13; this is
  inherited Tauri metadata, **not verified support for macOS 10.13**.
- `hdiutil verify` passed for the generated DMG. Its SHA-256 is
  `dd5c2a3b3639287e85fc9cdd904bc46b4fc7006ddd57d8f302ba0ada74d2f227`.

## Native UI observations

These observations used the actual native WKWebViews through computer-use UI
controls, not browser fixtures or injected callbacks. No microphone grant,
recording, provider request, real-user clipboard mutation or paste was performed.

| Case | Observed result |
| --- | --- |
| Development startup | `npm run dev:macos -- --no-watch -- --locked --offline` compiled and launched. |
| Development main/overlay rendering | Main loaded `localhost:1420/`; the second window rendered Listening, Provisional and `YapYap overlay fixture · 你好 😀`. |
| Packaged main/overlay rendering | With Vite stopped and no port 1420 listener, main loaded `tauri://localhost`; the second window rendered the same fixture. |
| Unsupported credentials | Native unsupported status was visible; password entry, Save, Check connection and Remove were disabled. |
| Unsupported clipboard | Clicking Copy test text displayed the native refusal: no paste or clipboard change was made. |
| Quit/restart smoke | Command+Q exited; a new packaged launch showed the shell with no old fixture. Full lifecycle acceptance remains MP-08. |

The unbundled development executable was not selectable by the computer-use app
inventory. For visual checks it was copied, without modifying its compiled code,
into an ignored app wrapper at `src-tauri/target/dev-ui-probe/YapYap.app`, using
the generated Info.plist and an ad-hoc signature. It used the development Vite
server and Tauri IPC; this is not installed-app evidence. Both dev windows were
observed with this wrapper. The release checks used the actual generated bundle.

The initial dev console reported duplicate React option keys because WKWebView
returned an anonymous microphone with an empty device ID before permission.
The selector now omits unselectable empty IDs and retains System default;
the repeated development check no longer reported that warning. Physical audio
capture and permission handling remain MP-03.

Native test command used for this run, from `desktop/src-tauri`:

```sh
CARGO_HOME=/private/tmp/yapyap-cargo RUSTUP_HOME=/private/tmp/yapyap-rustup \
  /private/tmp/yapyap-cargo/bin/cargo test --lib --locked --offline
```

## Changes and reproduction

The unchanged Windows insertion implementation is selected only on Windows.
Other platforms use IPC-compatible stubs that refuse capture, paste and clipboard
changes; insertion returns all attempted/sent/restored flags false. No secret
storage or transport implementation has been added. The Mac UI labels the shell
as a feasibility probe and disables key entry on the unsupported backend.

`tauri.macos.conf.json` selects app/DMG bundles; Info.plist adds microphone usage
text and Entitlements.plist declares audio input. The bundle identifier was then
`app.byokdictation.hotkeyprobe` (now `com.jingxuan-zhang.yapyap`); Windows NSIS
settings remain in the base config.
Minimum supported macOS remains unverified; no new minimum is claimed.

The first app bundle had only a linker ad-hoc signature, without the configured
entitlement. Added `signingIdentity: "-"` for a complete local ad-hoc bundle
signature. The first sandboxed DMG attempt failed at `bundle_dmg.sh`; retrying
outside the sandbox passed. This does not prove distribution/Gatekeeper acceptance.

From `desktop`, after Rust is available:

```sh
npm run dev:macos
npm run build:macos -- --ci
```

Settings → Developer diagnostics → Show overlay fixture sends fixed, bounded
Unicode text through the existing native overlay path; Hide overlay fixture
clears it. These controls refuse changes while a dictation session is active.
They do not upload audio or call a provider.

The final build used the cached locked dependencies:

```sh
CARGO_HOME=/private/tmp/yapyap-cargo RUSTUP_HOME=/private/tmp/yapyap-rustup \
  CI=true npm run build:macos -- --ci -- --locked --offline
```

`CI=true` skips Finder window decoration for unattended DMG packaging. The built
artifacts remain under `src-tauri/target/release/bundle/{macos,dmg}`. The packaged
main window was left open; development app/server were stopped.

Configuration references: [Tauri bundles](https://v2.tauri.app/distribute/macos-application-bundle/),
[ad-hoc signing](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing),
[DMG CI handling](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/dmg/mod.rs).

## Pending verification

Keychain, HTTPS/provider transport, microphone/AudioWorklet capture, physical
hold/release shortcuts, safe destination checks, clipboard preservation and
overlay focus/display behavior remain MP-01 through MP-08. Developer ID signing,
notarization, downloaded-app Gatekeeper acceptance, Applications installation,
clean-machine testing and signed upgrades remain MP-09. Windows native regression
acceptance is unverified; the Windows insertion source itself is unchanged.
MP-00 success establishes a runnable shell, not macOS dictation support.
