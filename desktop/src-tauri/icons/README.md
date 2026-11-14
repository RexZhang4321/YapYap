# App icon

`source.png` is the transparent source artwork: five white waveform capsules on a
teal rounded-square tile that matches the app's accent palette.
Tauri's icon command derives the native PNG, ICO and ICNS assets from it; the
128-pixel PNG is also copied to `src/assets/app-icon.png` for the app header and
browser favicon. All production assets live in the repository.

NSIS has separate installer and uninstaller icon settings. Both
`bundle.windows.nsis.installerIcon` and `uninstallerIcon` in `tauri.conf.json`
explicitly point to `icons/icon.ico`, so setup and uninstall use the app artwork
instead of NSIS's default icons.

The icon uses a brighter teal gradient. App controls use a deeper teal (`#087f82`)
for readable text and button contrast, with pale teal surfaces (`#e5f5f3`). The
dictation overlay uses a dark teal background (`#183c3c`) with a mint signal.

From `desktop`, regenerate into a disposable output directory with:

```powershell
npm.cmd run tauri -- icon src-tauri/icons/source.png --output src-tauri/target/generated-icons
```

Copy the corresponding files back to this directory and the 128-pixel PNG to
`src/assets/app-icon.png`. Mobile outputs are not used.
