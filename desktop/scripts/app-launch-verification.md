# App icon and relaunch verification

These results describe earlier BYOK Dictation builds. The current product is
YapYap; see [the rename verification](rename-verification.md) for its candidate.

Date: October 6, 2026. Windows x64 candidate: 0.1.0.

The native builder registers Tauri's single-instance plugin before the shortcut
plugin. A second launch asks the first process to show, unminimize and focus its
main window, then exits. The tray's Open Dictation command uses the same window
restoration helper. Reopening keeps the original WebView and dictation session.
Installed and development builds share the existing app identifier.

The built-in imagegen tool produced a transparent blue tile with a white voice
waveform. Tauri generated the native icon assets; the React header and browser
favicon use the same artwork. The source and prompt are in
[icons/README.md](../src-tauri/icons/README.md).

## Automated checks

- TypeScript and Vite production builds passed for both entry points.
- 165 deterministic frontend checks passed.
- 19 rendered Edge checks passed.
- 26 native checks passed; seven opt-in platform/provider tests remained ignored.
- Rust formatting passed. npm audit reported zero vulnerabilities.
- The full unsigned `npm.cmd run release:windows` command exited 0, including
  four scanner regression checks and the default repository/build/Git scan.

## Windows acceptance procedure

Quit earlier versions before installing this candidate: the old build has no
single-instance guard. Stop development clients too. Install the new package and
launch the installed executable without a Vite server. Use Task Manager to confirm
the same application PID survives each repeat launch; WebView2 subprocesses are
expected and are not additional dictation app instances.

1. With the main window visible, launch the app again. The same window receives
   focus and only one dictation process remains.
2. Open Settings, close the main window with its title-bar X, and launch again.
   The existing window and Settings dialog return without resetting navigation.
3. Minimize the main window and launch again. The original window restores.
4. Close the main window, reopen it from the tray, and confirm it restores.
5. Quit from the tray, confirm the process exits, then launch again. A new process
   starts normally, confirming the single-instance lock was released.

No dictation or provider request is necessary for these checks. Physical
microphone, insertion, suspend/resume, signing and the remaining release gates
are tracked separately in [Task 17 verification](task17-verification.md).

## Observed installed-app results

The rebuilt per-user NSIS installer exited 0. The installed application opened
without a Vite server. Screenshots confirmed the waveform icon in the title bar
and app header, and the app reported Ready to dictate.

| Check | Observed result |
| --- | --- |
| Visible relaunch | Passed. The new process exited 0; the original PID 19272 and one app process remained. The original window came to the foreground. |
| Hidden relaunch | Passed. Closing the main window removed it from the targetable windows list, while the original process stayed running. Relaunching showed the same main window and PID. |
| Settings preservation | Passed. Settings remained open after hiding/reopening the main window, with the same selected microphone and shortcut visible. |
| Minimized relaunch | Passed. Clicking Minimize followed by relaunch restored the original window with Settings still open. The duplicate process exited 0 and only the original PID remained. |
| Tray Open Dictation / Quit / fresh restart | Not exercised in this pass. The tray's Open command calls the same restore helper; explicit menu and lock-release acceptance remains pending. |

The app was left open on its home screen. No key draft was entered, no preferences
were changed and no dictation/provider request was initiated.

Installer: `src-tauri/target/release/bundle/nsis/BYOK Dictation_0.1.0_x64-setup.exe`,
1,644,414 bytes, unsigned. SHA-256:
`F3CD4B07D00CF132F5811B60F357B1C6144D06EC12AC377DB763328ED379DC8B`.
The manifest identifies source commit `372f47dc9f22911a9fcedb106a9e0ab0231d78b1`
plus the uncommitted icon and single-instance changes.

## Teal palette follow-up

Later on October 6, the icon was recolored with the built-in imagegen tool and
the app controls, shortcut badge and overlay were updated to teal. TypeScript,
both Vite entry points, the locked native release build and NSIS packaging passed.
White text on the primary accent has a 4.81:1 contrast ratio; shortcut text on its
badge has a 4.54:1 ratio. The native startup implementation was unchanged.

The teal candidate has not been installed by automation. The installed-app
observations above belong to the earlier blue candidate. The user reported that
the automated installation did not appear in Windows Settings; a normal desktop
installation must explicitly verify Installed apps visibility and uninstall.

The rebuilt teal installer supersedes the earlier artifact: 1,644,609 bytes,
unsigned, SHA-256
`C14956C90C08E1CAEB2596977D1E9A80D6AC215401476E610FFAD35F17F4E23B`.
Its manifest and checksum were updated to identify this build and its limited
verification scope.

### Installer icon follow-up

NSIS's separate installer and uninstaller icon settings now point to the app's
teal `icons/icon.ico`. Production frontend, locked native release and NSIS builds
passed. The generated NSIS script confirms both paths; all six ICO image payloads
were matched byte-for-byte in the setup executable's PE resource section.

Latest installer: 1,682,972 bytes, unsigned, SHA-256
`E949CAE3BB272F4A6A5D3CAB8E93AF08F8806F4539E2348F9C6EC49FA5757B13`.
Its manifest and checksum supersede the previous teal candidate's. It has not
been installed by automation.
