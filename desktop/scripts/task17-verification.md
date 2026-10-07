# Task 17 — Packaging and release verification

Earlier artifacts and observed titles below retain the BYOK Dictation name.
The current product is YapYap; see [rename verification](rename-verification.md)
for its build and remaining installed-app acceptance.

Date: October 5, 2026. Candidate: 0.1.0. Build host: Windows x64, build 26200. Scope: existing single-segment processing pipeline.

## Automated evidence

- Frontend deterministic checks: 165 passed.
- Native checks: 26 passed, seven opt-in platform/provider tests ignored.
- Rust formatting: passed.
- Production frontend: TypeScript and both Vite entry points passed.
- Rendered Edge fixtures: 19 passed; the managed fixture runner exited successfully.
- NSIS installer: per-user Windows x64 package built successfully. The complete unsigned release command exited 0 and generated its checksum and manifest.
- Credential leak scanner regressions: four passed. Default repository/build/Git scan passed. A separate audit in the user's Windows account enabled saved-key and app-profile comparison, scanned 1,035 files/build outputs and 668 Git objects, and found no matching key exposures or unreadable selected files.
- Post-startup audit: incomplete. The process remained running with a BYOK Dictation window, but WebView2's EBWebView/Default/Network/Cookies file could not be read during the 1,043-file scan. Rerun the saved-key/app-profile audit after tray > Quit; the successful pre-launch scan does not establish readability of this running cache file.
- Trusted signing: pending. No CurrentUser code-signing certificate was found in the user's Windows account. Signing configuration and build integration are provided. The build checks the installer signature; verify-windows-signatures.ps1 checks the installer and actual installed payload together. The real provider-backed path is untested. The signature verifier correctly rejected this unsigned candidate.

The initial compiler and browser runner were denied access to the default user temp directory. Workspace-local TEMP/TMP resolved that restriction. The original Playwright shell-managed server hung during teardown after all 19 assertions passed; the runner now owns and closes its fixture server directly. Both reruns completed successfully.

Release dependency installation found [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) in source-map-js 1.2.1, a transitive build dependency. The scoped lockfile update selects 1.2.2; npm reports zero vulnerabilities. The full frontend/browser/native checks and production package passed after the update. Signature/checksum module loading required explicit imports from the Windows PowerShell host because npm inherited PowerShell 7's module search path. Missing signed configuration is rejected before dependency installation/build; real signing still requires provider verification.

## Installed-app acceptance

Install the generated setup executable, stop development servers, and launch from Start. Use disposable text fields and synthetic/non-sensitive speech. Real dictation sends audio/text directly to OpenAI and can incur API charges. Record actual observations here; fixture results don't establish physical-device acceptance.

| Check | Procedure and required observation | Result |
| --- | --- | --- |
| Installation/startup | Install as an ordinary user; launch with no Vite server. Main window, tray and Settings work. | Partial: per-user installer exited 0; Windows records version 0.1.0. Installed executable launched and process reported a BYOK Dictation main window. Visual/tray/Settings interactions need user confirmation. |
| Fresh account/runtime | On a fresh Windows account or second machine, verify setup/key entry, microphone permission and WebView2 prerequisite handling. | Pending |
| Physical microphone and targets | Dictate into Notepad, VS Code and a browser field. Exactly one final insertion, passive overlay, original recoverable, previous clipboard restored. | Pending |
| Repeat dictation | Complete three consecutive dictations without a required discard. Earlier originals remain available. | Pending |
| Restart preferences | Change shortcut/device/processing preferences, quit and relaunch. Preferences and key presence survive; key field is empty. | Pending |
| Tray/quit | Closing main window leaves dictation available. Tray reopens it. Quit stops the process and releases shortcut/capture. | Pending |
| Windows restart | Reboot, manually launch from Start, and complete another dictation. | Pending |
| Sleep/resume idle | Sleep while idle, resume, and complete a dictation without restarting. | Pending |
| Sleep/resume active | Sleep during recording/finalization; resume. No unexpected or duplicate paste; interrupted work has visible recovery or can be discarded. | Pending |
| Microphone selection | Switch between two devices/default input, confirm selected device capture, then restart and confirm preference handling. | Pending |
| Device disconnect | Unplug selected microphone during recording. Visible interruption, recoverable partial audio or explicit discard; reconnect and record again. | Pending |
| Permission denial/retry | Deny capture, verify actionable setup error; restore Windows/app permission and retry successfully. | Pending |
| Shortcut conflict/second launch | Rebind a conflicted shortcut and launch another instance. Document actual conflict behavior; no duplicate insertion. | Pending |
| Network loss/retry | Disconnect before release, observe retained audio; reconnect and explicitly retry without recording again. | Pending |
| Cancellation | Cancel during recording and finalization; no late paste and another session works. | Pending |
| Changed destination | Move focus/caret during processing; insertion refused, original retained and Copy/retry guidance works. | Pending |
| Reinstall/upgrade | Quit, reinstall same version; separately test a later-version upgrade when available. Key/preferences retained as intended, one launch entry. | Pending |
| Uninstall | Quit; uninstall via Windows Settings. App/shortcuts removed; document retained preferences/key. Remove key explicitly if desired. | Pending |
| Signed artifact | Review publisher and valid timestamped app/installer signatures, then repeat install/start/dictation on final signed candidate. | Pending |

## Release result

Artifact: src-tauri/target/release/bundle/nsis/BYOK Dictation_0.1.0_x64-setup.exe, 1,604,966 bytes, unsigned. SHA-256: `2837703E08B65787D5D65C48509A2BABE7C6F1C7BBE529CC47640576B48572E6`. Source commit: `20ece52e6d29dd5b79c0fa3feb6412a2b78336a6` plus current uncommitted packaging changes; manifest marks the working tree dirty.

Installed location: `%LOCALAPPDATA%\BYOK Dictation\desktop.exe`. The installed executable was compared byte-for-byte with the built executable after replacing exactly one `__TAURI_BUNDLE_TYPE_VAR_UNK` marker with `__TAURI_BUNDLE_TYPE_VAR_NSS` in memory. They match completely under that expected transformation; only three bytes differ. Tauri patches the payload for the package, then restores the standalone file. See the [CLI 2.11.5 bundler implementation](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle.rs). No binary was modified by this verification.

The installed app was launched with synthetic-microphone/debug flags excluded and reported a visible BYOK Dictation main window without a development server. No live provider request or dictation was initiated by automation. Full manual Windows acceptance is pending. This record doesn't close Task 10's combined native validation, the UX checkpoint, or Task 16's full privacy/lifecycle audit.

## October 6 — Icon and single-instance follow-up

The new candidate replaces the generated installer above with the blue waveform
icon and single-instance startup. The full unsigned release command passed again:
165 frontend checks, 19 rendered checks, 26 native checks (seven ignored), Rust
formatting, production builds, four scanner regressions and the default leak
scan (343 files/build outputs and 505 local Git objects). npm reported zero
vulnerabilities. This default scan did not compare the saved key or app profile.

The updated per-user installation exited 0. Native screenshots confirmed the
main window, new title-bar/header icons and Settings. Relaunching while visible,
minimized or hidden in the tray restored the same window and original process;
Settings stayed open across hide/relaunch. Each duplicate launch exited 0 and
only one dictation app process remained. See [app relaunch verification](app-launch-verification.md)
for evidence and the repeatable procedure. Tray-menu Quit/reopen, shortcut
conflicts, physical dictation and the other lifecycle/signing gates above remain
pending.

Current installer: `src-tauri/target/release/bundle/nsis/BYOK Dictation_0.1.0_x64-setup.exe`,
1,644,414 bytes, unsigned. SHA-256:
`F3CD4B07D00CF132F5811B60F357B1C6144D06EC12AC377DB763328ED379DC8B`.
Source commit: `372f47dc9f22911a9fcedb106a9e0ab0231d78b1` plus uncommitted icon
and single-instance changes, as recorded in the dirty-tree manifest.

### Teal palette candidate

The icon, app accents and dictation overlay now use teal. TypeScript, both Vite
entry points, the locked native release build and NSIS packaging passed. Primary
button and shortcut text contrast were verified. The functional checks and
installed-app relaunch evidence above were collected on the earlier blue
candidate; they were not rerun for this color-only change.

The first teal installer superseded the earlier artifact: 1,644,609 bytes,
unsigned, SHA-256
`C14956C90C08E1CAEB2596977D1E9A80D6AC215401476E610FFAD35F17F4E23B`.
The checksum and manifest reflect this build. It has not been installed by
automation. The user reported the earlier app was missing from Installed apps
despite a readable uninstall entry. Run the installer from the normal Windows
desktop and verify visibility and uninstall before claiming installation
acceptance complete.

### Latest candidate — Installer and uninstaller icons

NSIS `installerIcon` and `uninstallerIcon` now explicitly use `icons/icon.ico`.
The TypeScript/Vite build, locked native release build and NSIS bundle passed.
The generated NSIS script points both icon settings at the app's ICO file, and
all six ICO image payloads (16, 24, 32, 48, 64 and 256 pixels) were matched
byte-for-byte inside the setup executable's PE resource section.

Current installer: 1,682,972 bytes, unsigned, SHA-256
`E949CAE3BB272F4A6A5D3CAB8E93AF08F8806F4539E2348F9C6EC49FA5757B13`.
The checksum and manifest were refreshed. This candidate has not been installed
by automation; normal desktop installation and uninstall acceptance remain
pending.
