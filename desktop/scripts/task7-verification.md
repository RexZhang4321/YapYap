# Task 7 Windows verification

Recorded on October 2, 2026, with user-reported physical microphone and network-outage follow-ups on October 3. The implementation is verified with real OpenAI streaming and a synthetic WebView2 microphone. The user reports that both the physical microphone test and the network-outage check work.

## Observed results

- The explicit native saved-key configuration probe connected to OpenAI and received acceptance of the transcription-only `gpt-live-transcribe` configuration. It uploaded no audio. Credential retrieval occurred only in Rust/Windows Credential Manager; the sandboxed process could not see the user's credential, while the normal Windows-user process passed.
- An eight-second live probe used the existing AudioWorklet capture at 48,000 Hz with Fake Default Audio Input. Its independent preview conversion sent 24 kHz mono PCM16 through binary IPC and the native WebSocket. Twenty real transcript deltas arrived before release, followed by one completed item. The live view recognized the fixed synthetic phrase and contained 100 characters. First visible text was measured at 1,727 ms after capture started. The session remained `ready` with 7.98 seconds of original PCM/WAV/playback available and no canonical transcript or paste.
- Subsequent checks measured first visible text at 1,004–1,100 ms. These are a few synthetic observations, not representative latency/accuracy acceptance targets or a measured distribution.
- The interruption helper notified the real frontend of a fixed disconnect at its transport seam and closed the actual native connection. After the preview stopped, recording continued. On the final run, 9.51 seconds of original 48 kHz PCM remained available; the failed preview retained 31 characters and showed a disconnect warning. An explicit real whole-recording request returned a recognized canonical transcript of 123 characters, released original audio and left the probe session `ready` without automatic insertion. The fixture can repeat through fake capture, so this longer recording has more text than the first eight-second example.
- The reconnect helper displayed the disconnect warning, opened a second real provider connection while capture continued, received further real deltas and a completion, retained earlier words and visibly marked the connection gap. It reported 26 deltas, one completion, 143 live characters and a complete 9.50-second original recording. Reconnect resumes from current audio; it does not replay missing preview audio.
- Cancellation 300 ms after press and cancellation after 3.5 seconds both reached `discarded`, cleared live/canonical text, hid playback and retained no recording. The latter had already received eight real deltas before cancellation. A following new session/cancellation succeeded, with no late text restored.
- Probe mode deliberately skips destination capture and automatic insertion. The preexisting normal dictate mode retains its original whole-recording canonical insertion behavior and can also display the optional preview. Existing insertion/cancellation tests pass; no new native target-app paste or full physical-key hold was claimed in this Task 7 run.

## Test boundaries and privacy

The speech fixture was generated locally using the existing Windows System.Speech helper. Only that fixed synthetic speech was uploaded. Shortcut Pressed/Released events were replayed through the registered handler. Capture, AudioWorklet processing, resampling, IPC, TLS/provider requests, transcript deltas/completion and final file transcription were real.

The interrupt/reconnect helpers close the real native socket and inject a fixed disconnect event; they do not disconnect the physical network. Independent deterministic native tests exercise unexpected socket closure without an injected provider notification. On October 3, the user reported that the physical microphone test works perfectly and that the network-outage check also works. These are user-observed passes; no numerical latency measurement or separate result for the optional reconnect-during-capture check was supplied. Representative-language/background-noise latency evaluation remains a manual follow-up in the README.

The app saves no real audio or transcripts to disk and emits no content/credentials to ordinary logs. Synthetic fixture and optional QA artifacts are ignored build output. Helpers print only fixed statuses, counters, duration/device metadata and recognition booleans. The saved credential is neither returned to the UI nor printed by the probes.

## Deterministic verification

- `npm test`: 29 checks covering session/insertion behavior, UI credential privacy, live deltas/completion, resampling across chunk boundaries, backlog/text limits, queued final samples before commit, startup/active cancellation, late events, reconnect gaps and original-audio/canonical recovery.
- `cargo test --lib --offline`: 18 passing checks, five explicit opt-in helpers skipped. Streaming tests use in-memory WebSocket peers for configuration acknowledgement, Base64 PCM preservation, deltas before commit, completion, bounded queues, stale IDs, cancellation while awaiting configuration and unexpected socket closure.
- TypeScript/Vite build, native debug build and Rust formatting passed.
- The four leak-scanner regression checks and pattern-only repository/build/Git scan passed. With the synthetic app closed to release its cookie database, the redacted saved-key/app-data audit checked all 486 selected files/build outputs and 271 Git objects with no matching key exposures or unreadable files.

Repeatable synthetic setup and the physical-device checks are in [the README](../README.md). Quit the test app and remove process-local fake-device/debugger flags before launching normally. Next: Task 8, a non-focus-stealing floating overlay.
