# macOS gap probes

Created October 6, 2026. Companion: [port scope](MACOS_PORT_SCOPE.md).
This is the execution checklist for investigation before the full port.
MP-00 passed on October 7, 2026; MP-01 through MP-10 are not started. The earlier source
assessment is not a native pass. See [MP-00 evidence](desktop/scripts/macos-mp-00-verification.md).

Use an Apple Silicon Mac for the first pass. Record its macOS version, hardware,
toolchain, source revision and bundle identity. Minimum OS and Intel coverage
remain decisions to make from evidence. Use small adapters and disposable
fixtures; keep Windows runnable. Any temporary Mac stub must explicitly refuse
unsupported operations rather than return success.

## Order and checkpoints

| ID | Probe | Depends on | Initial timebox |
| --- | --- | --- | --- |
| MP-00 | Build and evidence harness | — | 2–4 hours |
| MP-01 | Destination metadata and Accessibility | MP-00 | 3–5 hours |
| MP-02 | Guarded paste and clipboard | MP-01 | 4–6 hours |
| MP-03 | WKWebView microphone and AudioWorklet | MP-00 | 3–5 hours |
| MP-04 | Physical hold-to-talk | MP-00; combine with MP-03 | 2–3 hours |
| MP-05 | Passive overlay and display placement | MP-01, MP-04 | 2–3 hours |
| MP-06 | Keychain persistence and failure handling | MP-00 | 2–3 hours |
| MP-07 | HTTPS and live transport | MP-00; MP-06 for provider checks | 3–5 hours |
| MP-08 | Lifecycle, preferences and permission recovery | MP-03 through MP-06 | 2–3 hours |
| MP-09 | Signed bundle and distribution | MP-00, MP-06; repeat after MP-10 | 3–5 hours plus external turnaround |
| MP-10 | Combined failure/recovery flow | MP-01 through MP-08 | 3–5 hours |

Timeboxes are investigation limits, not commitments to solve every failure.
Use the first 2–3 working days for a smoke pass of MP-00 through MP-05. Reserve
roughly 5–8 working days for all probes and their failure cases; this is broader
than the feasibility spike in the original scope. Stop expanding a failed probe
at its timebox, record the evidence and proposed fallback, then continue any
independent probe. Re-estimate implementation only after the results are known.

## MP-00 — Establish a runnable Mac probe shell

- [x] Inventory Node/npm, Rust/Cargo and Xcode tools; identify missing prerequisites.
- [x] Install locked npm dependencies and attempt the locked native build. Record
  the actual compiler errors before refactoring; avoid a broad dependency upgrade.
- [x] Put Win32 insertion behind target configuration. Preserve the existing IPC
  signatures using fail-closed Mac stubs until the relevant adapters are probed.
- [x] Add a Mac build config for `.app`/DMG, microphone usage text and audio-input
  entitlement. Preserve the Windows NSIS config and existing application identity.
- [x] Launch both development and packaged apps; verify both React entry points
  load, the main window renders, and the overlay can receive bounded fixture state.
- [x] Add the smallest local probe controls/results needed. Reuse existing
  Developer diagnostics and fixed insertion fixtures where possible. Do not
  assume WebView2 CDP or PowerShell helpers work on Mac.
- [x] Run frontend tests/build and native tests/formatting once runnable; classify
  failures as platform implementation, fixture assumption or missing dependency.

**Exit:** a packaged Mac shell launches without Vite and produces reproducible
probe evidence. Unsupported features are visibly unavailable. Record build
commands, errors, config changes and test counts.

## MP-01 — Can we reliably identify the intended input?

- [ ] Check Accessibility trust with access denied and granted; record actual
  permission behavior and whether recovery requires relaunch.
- [ ] Capture only local destination metadata: process, window, focused element,
  role, available selected range/caret metadata and pointer position. Bound query
  time. Avoid collecting document contents or logging input values.
- [ ] Start with disposable TextEdit and Safari fields. Extend the read-only
  matrix to a Chromium browser, VS Code and a representative chat application.
- [ ] Capture, wait, and revalidate: unchanged input, different app, another field
  in the same window, moved caret, changed selection, closed window, and secure
  field. Include a noneditable target and an app with unavailable AX attributes.
- [ ] Record for each target whether element/selection identity is stable and
  whether changes can be detected. App/process identity alone does not pass.

**Exit:** an application-by-application support table with a conservative rule
for auto-insertion versus Copy. If cursor changes cannot be detected, document
that target as unsupported for automatic insertion pending a better guard.

**Decision:** Accessibility adapter is sufficient, needs a targeted workaround,
or cannot support safe insertion for a listed application. No paste in this probe.

## MP-02 — Can we paste once and preserve the clipboard?

- [ ] Implement the smallest native fixed-text Command+V probe using MP-01 target
  checks and session ownership. Wait for held modifiers to release; bound waits.
- [ ] Use disposable inputs to test Unicode, emoji, multiline text and identifiers.
  Run ten unchanged-target cycles in TextEdit and a browser; record exact-match,
  dispatch/refusal, clipboard-restoration outcomes and elapsed times separately.
- [ ] Repeat MP-01 changed-target cases immediately before dispatch. Verify zero
  paste events on refusal. Reissue the same session command and verify no duplicate.
- [ ] Snapshot/restore empty, text, rich text, image, file and multi-item clipboards
  using disposable fixtures. Record readable item types, total bytes and which
  formats cannot be preserved; refuse before replacement when backup fails.
- [ ] Test pasteboard permission denied/granted where exposed by the tested OS,
  unavailable/lazy data, size limits, and clipboard changes during backup/restore.
- [ ] Copy a newer fixture during the paste/restore interval; verify it survives.
  Test slower paste consumption before retaining the Windows 250 ms restore delay.
- [ ] Force pre-dispatch and post-dispatch failures separately. Keep attempted,
  refused and uncertain outcomes distinct. Test explicit Copy/Replace/Restore
  recovery and confirm uncertain dispatch cannot trigger an automatic retry.

**Exit:** fixed-text insertion and plain clipboard preservation pass in the first
two targets, with richer-format limitations and races documented. Event posting
alone is not proof of insertion; observe the actual disposable destination.

**Decision:** native pasteboard/event adapter and restore policy, supported
formats, safe refusal cases, and remaining application compatibility work.

## MP-03 — Does existing web audio capture work in the Mac bundle?

- [ ] Exercise the real `audioCapture.ts` path in development and packaged WKWebView:
  `getUserMedia`, AudioContext resume, worklet loading, nonzero PCM and stop/flush.
- [ ] Speak a disposable phrase for 5–10 seconds; play back in memory and compare
  capture duration/frame count. Record sample rate, channels and track state.
- [ ] Hide the main window and focus another app while recording. Confirm capture
  continues and playback contains the complete beginning and ending.
- [ ] Test initial permission prompt, denial, retry after grant, and revocation.
  Test stop/cancel during permission or startup and verify no late recording starts.
- [ ] Test built-in mic and available external devices, selection/default changes,
  disconnect/reconnect and partial-audio retention. Mark unavailable hardware
  coverage as unverified rather than passing it through a synthetic fixture.

**Exit:** existing worklet produces usable, complete audio in the installed app,
or a reproducible failure identifies which layer blocks it.

**Decision:** keep web capture; make a bounded WKWebView/config fix; or schedule a
separate native capture comparison. Do not implement native capture by default.

## MP-04 — Are global press/release events reliable?

- [ ] Register the existing shortcut plugin with a tested Mac combination; record
  timestamps and event counts while TextEdit, a browser and VS Code have focus.
- [ ] Perform twenty physical hold/release cycles. Include short presses, held
  repeat and different modifier-release orders; require one start and one stop.
- [ ] Test a conflict, rebinding and restoration of the previous binding. Verify
  shortcut recording handles Command/Option and Esc without leaving keys captured.
- [ ] Verify global Esc registration while active and its removal after idle;
  document conflicts and the existing Cancel-button fallback.
- [ ] Combine with capture: early release during microphone startup, hiding the
  app, sleep/wake and Secure Input scenarios. Record which permissions are actually
  needed; do not add a low-level listener or Input Monitoring speculatively.

**Exit:** no missed or duplicate lifecycle events in the physical sample; blocked
cases recover without a stuck recording. Injected shortcut callbacks are separate
logic evidence and cannot establish physical shortcut reliability.

**Decision:** keep the plugin and choose a default, investigate a backend gap,
or evaluate toggle fallback with its user-visible tradeoff.

## MP-05 — Can the overlay remain passive in the right place?

- [ ] Capture destination before showing Listening; cycle Listening → Finalizing
  → Hidden with fixed preview text. Observe target focus before/after every show.
- [ ] Click and type through the overlay area in a disposable input; verify the
  target receives input and the overlay never becomes the focused destination.
- [ ] Test a foreground window on each available display, Retina scaling, menu
  bar/Dock work area, Spaces changes and full-screen applications. Record any
  unavailable multi-monitor coverage separately.
- [ ] Cancel/discard and reload the overlay; confirm late updates cannot restore
  old text and the overlay cannot invoke credentials, paste or shortcut commands.

**Exit:** focus preservation and placement pass on the available display setup,
with Spaces/full-screen policy and any missing coverage stated.

**Decision:** Tauri window flags suffice or a small AppKit window/panel adapter
is needed. Do not redesign the overlay UI to solve a native behavior problem.

## MP-06 — Does Keychain support our secret lifecycle?

- [ ] Use a unique disposable service/account, not the user's saved key. Test
  missing → save → read in a fresh process → replace → delete → delete again.
- [ ] Probe access using the packaged app and document behavior with Keychain
  locked or access denied. Remove the disposable fixture on completion.
- [ ] Preserve native-only reads, fixed error codes and zeroized owned buffers;
  prove the UI receives presence/results and never a raw-key getter.
- [ ] Check ordinary logs, settings, build output and app profile for the disposable
  secret; record any remaining leak-audit tooling gap for Mac paths.

**Exit:** secret persistence/replacement/deletion pass without plaintext storage
or raw-secret IPC. Repeat access after a signed upgrade in MP-09.

**Decision:** native Security framework or a narrowly scoped Rust wrapper, stable
service/account identity and denied/locked recovery behavior.

## MP-07 — Do HTTPS and WebSocket transports preserve existing behavior?

- [ ] Add the smallest Mac HTTPS adapter behind `openai::request`; enable Mac
  provider calls currently gated in transcription/cleanup without changing models.
- [ ] Use local fixtures first: success, redirect, oversized response, connection
  failure, invalid certificate, slow response and trickling-response timeout.
  Prove no forwarded credential on redirect, bounded waits and fixed UI errors.
- [ ] Reuse deterministic live-stream fixtures for connect/finish/cancel, stalled
  connection, socket loss, queue bounds and stale events. Check native-tls on Mac.
- [ ] With the established opt-in provider mode and native saved key, validate
  access, transcribe fixed synthetic audio, stream it and clean a fixed transcript.
  Check microphone capture separately; provider success cannot prove capture.
- [ ] Confirm a live failure retains original audio, final failure retains retry
  audio, and cleanup failure retains the canonical original. Record only sanitized
  status/count/timing evidence, never credentials or private dictation content.

**Exit:** transport behavior passes locally; real-provider results are recorded
separately or explicitly unverified. Provider permissions/model access failures
must be distinguished from Mac transport failures.

**Decision:** transport choice, timeout/TLS/error mapping changes, and any remaining
proxy/network coverage. Avoid refactoring working Windows WinHTTP in this probe.

## MP-08 — Does background operation recover cleanly?

- [ ] Verify close-to-hide, menu bar Open/Quit, minimize/reopen, Dock reopen and
  duplicate launch. Require one active session and one shortcut registration.
- [ ] Save fixture preferences, quit/restart and verify persistence. Confirm audio
  and transcript history clear on quit as designed; no crash recovery is claimed.
- [ ] Test permission denial/grant/revocation from MP-01/03 and clipboard denial
  from MP-02 through readiness/recovery UI. Record required restarts and OS wording.
- [ ] Sleep/wake during idle and capture; verify resources recover or stop visibly
  while retaining available recovery. No duplicate session or late paste may occur.

**Exit:** background lifecycle and permission recovery have reproducible outcomes
and do not lose recoverable dictation silently.

**Decision:** Dock/menu behavior, permission readiness states and lifecycle fixes.

## MP-09 — Can the installed identity be distributed and upgraded?

- [ ] Verify bundle identifier, microphone usage/entitlements and architecture in
  the generated `.app`; test launch from Applications without the dev server.
- [ ] Inventory Developer ID/notarization access without exporting secrets. If
  credentials are unavailable, record signing as unverified and continue MP-10.
- [ ] With available credentials, sign/notarize/staple the minimal bundle/DMG and
  verify it through a browser-downloaded artifact in a clean test account or Mac.
  A local ad-hoc launch does not prove downloaded-app Gatekeeper acceptance.
- [ ] Upgrade a signed probe build while keeping identity stable; check fixture
  preferences, disposable Keychain access, microphone and Accessibility grants.
- [ ] Repeat signing and installed checks for the integrated MP-10 artifact.

**Exit:** reproducible packaging/signing path and installed upgrade results, or a
specific account/service blocker. Do not mark the rest of the port blocked solely
because distribution credentials or a second machine are unavailable.

**Decision:** distribution prerequisites and identity policy; no App Store work
or Intel support is implied by this probe.

## MP-10 — Does the combined flow retain the Windows guarantees?

- [ ] Run physical hotkey → microphone → live overlay → release → final STT →
  cleanup → guarded paste in TextEdit and a browser. Use local provider fixtures
  first, then the established opt-in synthetic/provider pass. Label evidence.
- [ ] Repeat with live preview/cleanup/full-audio switches in their supported
  combinations, checking each path uses its existing transcript source policy.
- [ ] Cancel during startup/capture/finalization; force final-STT failure and retry
  from identical retained audio; force cleanup failure and recover canonical text.
- [ ] Change destination during finalization; choose a new destination explicitly
  for a refused-paste retry; verify no retranscription or duplicate dispatch.
- [ ] Exercise uncertain paste, clipboard restoration failure, newer user copy,
  retained results, discard and immediate next dictation; preserve recovery states.
- [ ] Run appropriate frontend/native/build checks and arrange Windows regression
  evidence for shared-code changes. Keep missing Windows/native checks explicit.

**Exit:** combined observed flow plus failure matrix. Standalone capability passes
and mocked browser tests do not close combined native acceptance.

**Decision:** ready to implement/polish the port, or a revised scope identifying
the exact unsolved capability and its cost.

## Evidence and final deliverable

Store a concise versioned note per probe under `desktop/scripts/` when executed
(suggested name `macos-mp-XX-verification.md`). Generated disposable screenshots,
fixtures and build artifacts belong in ignored build output. Record:

- Build revision, bundle/signing identity, OS/hardware, commands and fixtures.
- Each case and observed result: passed, failed, unverified or blocked.
- Whether evidence was automated, directly observed or user reported; whether
  physical input, installed app and provider transport were real or simulated.
- Limitations, reproduction steps, recovery result and chosen next action.

After the probes, update the port scope with a capability matrix, supported
targets/OS assumptions, adapter decisions, outstanding verification and revised
implementation estimates. A failed supported path becomes an implementation
task; missing hardware/account access remains an explicit verification gap.
