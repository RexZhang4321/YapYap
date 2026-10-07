# App icon

`source.png` is the transparent artwork generated and recolored with the built-in
imagegen tool. Its teal tile matches the app's accent palette.
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
`src/assets/app-icon.png`. Mobile outputs are not used by this Windows app.

Generation prompt:

```text
Use case: logo-brand
Asset type: Windows desktop app icon for YapYap, a hold-to-talk voice dictation app.
Primary request: A simple, modern, elegant icon. One distinctive white voice waveform mark made from five evenly spaced vertical rounded capsules, short outer capsules, medium inner capsules, tall middle capsule. Centered inside a deep muted blue rounded-square tile matching #28658c, with a very subtle blue tonal gradient. Bold clean silhouette, generous padding, beautifully balanced proportions, crisp smooth edges and high contrast even at 16 pixels. Flat graphic design, restrained and polished.
Composition: one icon only, front-facing orthographic, square canvas, tile fills about 88 percent of canvas with rounded corners. Transparent outside the tile.
Constraints: no text, no letters, no border, no shadow outside the tile, no glow, no 3D, no surrounding scene, no mockup, no extra symbols.
```

Final teal edit prompt (applied to the generated blue icon):

```text
Use case: precise-object-edit
Edit target: the attached YapYap app icon.
Change only the blue tile color to a more appealing, fresh, saturated teal. Use a very subtle tonal gradient from #22b8ad near the upper left to #087f88 near the lower right, with an overall teal color around #109c98. Keep the exact same five white rounded waveform capsules, their proportions, alignment, spacing, tile size, rounded corners, and composition. Retain the clean, simple, modern, elegant flat graphic appearance. Preserve the genuine transparent background outside the tile and make that exterior fully clean with no stray colored pixels or specks. No lettering, extra shapes, outlines, glow, or external shadow.
```
