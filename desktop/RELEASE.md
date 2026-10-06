# Windows packaging and release

The initial package is BYOK Dictation 0.1.0 for Windows x64. The NSIS installer installs for the current Windows user. Keep the existing app identifier and Credential Manager target stable so development users retain their configuration. The current icon is retained; final branding remains a pre-distribution decision.

## Build a local test installer

Use Windows with Node/npm, Rust's MSVC toolchain, Visual Studio C++ build tools and a Windows SDK, Python 3, and Microsoft Edge installed. Dependencies come from package-lock.json and Cargo.lock. First-time dependency and packaging-tool downloads require network access. Quit the native client through its tray menu before launching an installed replacement; closing the window only hides it.

From desktop/:

```powershell
npm.cmd run release:windows
```

The script reinstalls npm dependencies from the lockfile, checks npm advisories (high/critical findings fail the run), runs deterministic frontend tests, rendered Edge checks, Rust formatting and native tests, then builds the release executable and NSIS installer with Cargo's lockfile enforced. It runs the credential scanner regression checks and the default repository/build/Git leak scan. Dependency installation/audit needs npm registry access. It reads no saved credential and makes no provider requests. It keeps compiler/browser temporary files in ignored src-tauri/target/release-temp and restores the calling process's environment afterward.

Outputs are in src-tauri/target/release/bundle/nsis/:

- BYOK Dictation_0.1.0_x64-setup.exe (the bundler determines the precise filename).
- SHA256SUMS.txt, containing the installer SHA-256.
- release-manifest.json, containing version, source commit, dirty-tree status, signature status, size and hash. A dirty-tree build is a test candidate; commit final source and rebuild for external release.

The default build is explicitly unsigned and suitable for local acceptance testing. The script does not install, publish, read a user's key, or run live dictation. Run the generated installer, then launch BYOK Dictation from the Start menu with all development servers stopped. Installation and acceptance results belong in [Task 17 verification](scripts/task17-verification.md).

## Windows permissions and runtime requirements

- **Microphone:** On Windows 11, use Settings > Privacy & security > Microphone. Enable Microphone access and desktop-app microphone access. Allow the app's capture permission if prompted. If denied, restore Windows access and use Allow microphone in app Settings; restart the app if Windows hasn't applied the change. See [Microsoft's microphone permissions guide](https://support.microsoft.com/en-us/windows/privacy/turn-on-app-permissions-for-your-microphone-in-windows).
- **WebView2:** The installer uses Tauri's downloadBootstrapper mode to install the runtime if missing. That step needs internet access and may involve a Windows elevation prompt. Don't ship with runtime installation skipped. Users need no Node, Rust, or development server. See [Tauri installer options](https://v2.tauri.app/distribute/windows-installer/).
- **Network/provider:** Dictation requires an OpenAI API key with access to the configured models and outbound HTTPS/WebSocket access to api.openai.com. The optional Check connection action sends a models request. Live preview streams audio while recording; full-audio transcription uploads the recording on release when enabled; cleanup sends the selected transcript when enabled. Live-only mode skips the full-recording request except for explicit full-audio recovery.
- **Credentials:** Windows Credential Manager stores the key for the current user. Preferences survive app restart; audio, transcripts, and recovery clipboard backups are memory-only and disappear on quit/crash. Uninstall should not be assumed to delete a generic Windows credential. Use Settings > Remove key before uninstall if desired, or remove app.byokdictation.hotkeyprobe/openai-api-key in Windows Credential Manager.
- **Shortcut and insertion:** No macOS-style Accessibility permission is required. Keep the shortcut available and run ordinary destination apps at the same privilege level. Windows SendInput cannot inject into higher-integrity processes, so insertion into an administrator-elevated editor is outside normal acceptance. Use manual Copy/paste recovery when needed. See [Microsoft's SendInput restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).
- **Startup:** Launch from Start after reboot. Automatic launch at Windows login is not currently implemented. Keep one native instance running; duplicate-launch behavior is a manual check, not a claimed single-instance guarantee.

Verify on each Windows version you intend to advertise. The build host is Windows 11 x64; Windows 10 and ARM64 support are not verified by an x64 installer build.

## Signing before external distribution

Use a code-signing certificate/service with a trusted publisher chain and timestamping. No usable CurrentUser code-signing certificate was found during this packaging pass. A self-signed certificate is not a substitute for trusted external distribution. Signing does not guarantee immediate Microsoft SmartScreen reputation.

For a signing provider that exposes a certificate usable by Windows SignTool:

1. Follow the issuer's setup instructions for its hardware token/KSP or signing client. Ensure Windows SDK SignTool is available.
2. Copy src-tauri/tauri.signing.example.json to src-tauri/tauri.signing.local.json (ignored by Git).
3. Replace the thumbprint and RFC 3161 timestamp URL with your provider's values. Never put passwords or private keys in this file.
4. Run from desktop/:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-windows.ps1 -Signed -SigningConfig src-tauri/tauri.signing.local.json
```

For a cloud or other provider, replace the certificate fields with bundle.windows.signCommand using the issuer's signing CLI. Tauri substitutes %1 with the artifact path. Keep service authentication outside the repository and command arguments; use the provider's credential mechanism. The same -Signed command then applies.

The build script requires a valid, timestamped installer signature. Tauri signs the patched executable that goes into NSIS, then restores the unsigned/unpatched standalone desktop.exe; checking that standalone file would check the wrong artifact. This behavior is visible in the [installed CLI version's bundler source](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle.rs).

Install that signed candidate, then verify the actual installed payload together with its installer (adjust the filename if the version changes):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-signatures.ps1 -Installer "src-tauri/target/release/bundle/nsis/BYOK Dictation_0.1.0_x64-setup.exe" -InstalledExecutable "$env:LOCALAPPDATA\BYOK Dictation\desktop.exe"
```

The verification script requires valid timestamped signatures with the same signer on both files and prints their hashes/publisher as JSON. Save that output with the release evidence, review the publisher identity, run the acceptance checks on this signed candidate, and retain its checksum. See [Tauri's current signing guidance](https://v2.tauri.app/distribute/sign/windows/); its legacy PFX walkthrough explicitly covers older certificates only. Signing-tool execution remains unverified until a real provider is configured.

## Release gate

Before external distribution:

1. Complete every applicable installed-app acceptance row in task17-verification.md with an observed result.
2. Run the saved-key/app-profile audit in your own Windows account after installed-app testing:

```powershell
# From the repository root; compares the saved key only in memory and prints no key.
python desktop/scripts/audit-key-leaks.py --check-saved-key --check-app-data
```

3. Resolve findings and unreadable files; an incomplete scan isn't a pass.
4. Finalize publisher/icon and supported Windows versions, commit source, and build the signed candidate.
5. Verify/retest that final installer; retain its manifest, checksum, verification record and release notes. Publish only the intended installer and public notes, never credentials or WebView profiles.

Task 17 remains incomplete until installed-app lifecycle acceptance and real signing are recorded. Building this current single-segment implementation does not claim completion of deferred segmentation, corpus evaluation, or the full Task 16 privacy/lifecycle audit.
