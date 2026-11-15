# Changelog

All notable changes to YapYap are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — unreleased

First public release.

### Added

- Hold-to-talk dictation with a global shortcut (default `Ctrl+Alt+F8`). YapYap keeps running in the tray or menu bar.
- Live words in a floating overlay while you speak, followed by a transcription of the full recording when you release.
- Optional light cleanup that removes filler words and fixes punctuation, leaving numbers, identifiers, URLs and filenames as spoken.
- Guarded paste at the cursor. YapYap checks that the target app, window and caret haven't changed, and afterward restores your clipboard without overwriting a newer copy.
- Recovery when something fails: retry transcription, copy the original transcript, play back or download the recording, or paste again into a new target.
- Processing phases (full audio transcription and cleanup) that you can turn on and off separately.
- The OpenAI API key is kept in Windows Credential Manager or the macOS Keychain and read only by native code.
- Windows x64 per-user installer.
- macOS (Apple Silicon) support when built from source.

### Security

- A strict Content Security Policy for packaged builds.

[Unreleased]: https://github.com/RexZhang4321/YapYap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/RexZhang4321/YapYap/releases/tag/v0.1.0
