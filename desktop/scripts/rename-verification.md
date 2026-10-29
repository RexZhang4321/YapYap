# YapYap rename verification

Date: October 6, 2026. Windows x64 candidate: 0.1.0.

## Scope

- Product, window titles, tray menu, header, overlay, and browser titles: **YapYap**.
- npm and Rust packages: `yapyap`; native library: `yapyap_lib`.
- Windows executable: `yapyap.exe`; NSIS installer: `YapYap_0.1.0_x64-setup.exe`.
- Installer publisher metadata and Start menu / Installed apps display name: **YapYap**.
- Release commands, signature examples, smoke helpers, and current documentation
  refer to the renamed artifacts. Source stays in `desktop/`.

At this rename the app identifier, Credential Manager target, and preference
storage key kept their original values for compatibility. On October 29, 2026
all three moved to `com.jingxuan-zhang.yapyap` names; see
[the release guide](../RELEASE.md#upgrading-from-byok-dictation). Earlier
verification records keep the original artifact names and observed titles.

## Automated build evidence

The full `npm.cmd run release:windows` workflow exited 0:

- 165 deterministic frontend checks and 19 rendered Edge checks passed.
- 26 native tests passed; seven opt-in platform/provider tests were ignored.
- Rust formatting and TypeScript/Vite production builds passed.
- npm audit reported zero vulnerabilities.
- Four credential scanner regression checks passed. The default scan checked
  349 files/build outputs and 582 local Git objects with no matching exposures.
- The locked optimized native build and NSIS packaging passed.

The generated NSIS script uses `YapYap` for `PRODUCTNAME` and `MANUFACTURER`,
`yapyap` for `MAINBINARYNAME`, and the retained app identifier for `BUNDLEID`.
The executable's Windows ProductName and FileDescription both report `YapYap`.
Package names, versions, window titles, publisher, and library metadata agree.

Artifact: `src-tauri/target/release/bundle/nsis/YapYap_0.1.0_x64-setup.exe`.
Size: 1,680,624 bytes. Unsigned. SHA-256:
`49F3566A44C3F382D640577F45478C463CCD86F95C281723EBB18B153C0C00E9`.
The manifest and checksum identify this candidate. Source commit:
`372f47dc9f22911a9fcedb106a9e0ab0231d78b1` plus the current uncommitted changes.

## Installation acceptance

The YapYap installer has not been installed as part of this rename. Quit and
uninstall BYOK Dictation first, leaving **Delete application data** unchecked.
Install YapYap and verify its Start menu entry, Installed apps entry, window and
tray names, saved-key presence, preferences, relaunch, and uninstall. See
[the release guide](../RELEASE.md#upgrading-from-byok-dictation).

Previous installed-app results do not establish acceptance of the renamed
candidate. Signing and the existing manual release gates still apply.
