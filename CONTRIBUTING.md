# Contributing to YapYap

Thanks for helping. Bug reports, fixes and small improvements are all welcome. For a larger feature, please open an issue first so we can agree on the approach before you write it.

## Set up

You need Node.js, Rust, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. All app source is in [`desktop/`](desktop/).

```sh
cd desktop
npm ci
npm run tauri -- dev       # Windows
npm run dev:macos          # macOS
```

On macOS, use `npm run install:macos` when you need a packaged build. It keeps one signed copy in `/Applications`, so your Accessibility, Microphone and Keychain grants survive rebuilds. See [desktop/README.md](desktop/README.md) for details.

## Test

From `desktop/`:

```sh
npm test                   # frontend and platform tests
npx tsc --noEmit           # type check
npm run test:ui            # rendered UI checks (Playwright)
```

From `desktop/src-tauri/`:

```sh
cargo fmt --check
cargo test
```

Regular tests use fixtures and fakes and never call OpenAI. Tests that make real API requests are marked `#[ignore]` and are opt-in, because they cost money and need a saved key.

If your change touches recording, the overlay, insertion or the clipboard, also try it in the real app on your platform. Say in the pull request what you tested and on which OS.

## Ground rules

These keep YapYap's privacy promises intact. A pull request that breaks one won't be merged.

- **Never log or display the API key, audio or dictated text.** That includes error messages from OpenAI, which can echo request content. Map failures to fixed error codes instead.
- **Keep audio in memory.** Don't write recordings or transcripts to disk. The one exception is when the user chooses **Download WAV**.
- **Only native code reads the key.** Don't add a Tauri command that returns it to the UI.
- **The webviews make no network requests.** Calls to OpenAI go through Rust. The Content Security Policy enforces this, so don't loosen it.
- **Respect the order of trust:** original audio › canonical transcript › cleaned transcript › live preview. Live words are never inserted automatically.
- **Never commit a key or certificate,** even an expired one. Test fixtures use obviously fake values such as `sk-disposable-…`.

Write down any choice that isn't obvious from the code in [docs/DECISIONS.md](docs/DECISIONS.md).

## Pull requests

- Keep each pull request to one change, and explain why it's needed.
- Make sure the tests above pass.
- Add an entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
- Platform-specific code goes in the platform modules (`desktop/src/platform/` and the per-OS files under `desktop/src-tauri/src/`), not behind runtime checks in shared code.

## Reporting bugs

Use the bug report form under **Issues**. Please don't paste your API key, recordings or private transcripts. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
