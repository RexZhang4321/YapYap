# WinHTTP session-reuse experiment

Measured October 5, 2026 (America/Los_Angeles), against the fast-mode baseline
committed as `730ad6e`.

## Decision

Do not enable shared sessions in production. The experiment did not demonstrate
a latency benefit, and the fresh-session baseline already reused sockets across
requests. The app retains its previous transport and Luna fast mode. The experimental
transport, benchmark harness, local regression tests, fixture preparation script,
test-only dependency, and raw measurement JSON were removed. This note retains
the approach and results; no runnable session-reuse benchmark remains in the codebase.

Microsoft documents [cross-session keep-alive pooling](https://learn.microsoft.com/en-us/windows/win32/winhttp/about-winhttp)
and [the concurrency rules for session and child handles](https://learn.microsoft.com/en-us/windows/win32/winhttp/concurrency-in-winhttp).
Creating a new WinHTTP session does not necessarily mean establishing a new TCP
connection or performing another TLS handshake.

## Method

The candidate retained one session with immutable options, shared through `Arc`.
Each worker owned its connection and request handles. A short mutex protected the
session cache without serializing network requests, and a generation guard
prevented stale failures from invalidating a replacement session. Requests were
not automatically retried. A future temporary harness can follow this protocol:

- Use a fixed local System.Speech synthetic recording of: "Hello from the dictation
  test. The meeting starts at three thirty. Please save the project tomorrow."
- Normalize the WAV to the app's PCM16 mono layout. This run used 16 kHz,
  7.690 seconds, 246124 bytes, SHA256
  `1664281f263d26df91fcb6a7b45ea18bfd21a799a0d0b96f9296095158105678`.
- Run a `gpt-transcribe` request, followed by `gpt-6-luna` cleanup of its actual
  canonical result. Cleanup requests use `service_tier: fast` and none reasoning
  in both arms. Prompts, response limits, TLS checks, redirects, and request
  payload generation are identical.
- Fresh arm creates and closes a session for each request, reproducing the
  existing production transport. Shared arm retains one session and creates
  request-specific connection/request handles. WinHTTP pools sockets at session
  level; connection handles describe destinations, rather than individual sockets.
- Keep Windows' existing global pooling behavior in both arms. Do not manufacture
  a benefit by disabling keep-alive for the baseline.
- Measure 12 paired rounds, alternating arm order: 24 pipelines / 48 requests.
  Two initial pipelines (four requests) are recorded separately and excluded.
  These are first uses of the respective clients, not independent system-cold
  measurements: global socket caches and provider warmup can cross arms.
- The total includes credential lookup, client setup, STT, canonical parsing,
  cleanup payload construction, cleanup, and parsing. Per-stage request timers
  include client setup and network response completion. They exclude frontend
  IPC, microphone drain/encoding, destination checks, and insertion.
- Test-only phase timers measure WinHttpOpenRequest/setup, WinHttpSendRequest,
  WinHttpReceiveResponse, and WinHttpReadData. In this environment most elapsed
  time appeared inside WinHttpSendRequest; these timings must not be interpreted
  as isolated upload or TLS costs.
- Query WinHTTP connection metadata after response headers and compare local
  socket ports only in memory. Persist only equality booleans, timing, token
  counts, returned tier, and recognition/preservation checks. Never log keys,
  transcripts, audio, network addresses, or port numbers.

## Results

| Stage | Fresh median | Shared median |
| --- | ---: | ---: |
| Transcription request | 0.589 s | 0.610 s |
| Cleanup request | 0.782 s | 0.802 s |
| STT + cleanup pipeline | 1.356 s | 1.565 s |

Shared won only 4/12 pipeline pairs; median paired saving was **-0.086 seconds**.
The observed 15.4% higher pooled median is not evidence that session reuse is
inherently slower; this small sample has cloud latency and output variability.
It is evidence insufficient to adopt this optimization.

Connection metadata reported the same local port between STT and cleanup in
all 13 pipelines for **both** arms, including initial pipelines. All 12 subsequent
shared pipelines also matched the preceding shared pipeline's local port. This
is consistent with existing cross-session pooling already eliminating repeated
connection establishment on the measured path. Local-port equality is a reuse
indicator, not packet-level proof of identical TLS state.

All 26 pipelines recognized the expected speech phrases and passed the cleanup
preservation guard. Every cleanup returned the fast tier. Canonical transcripts
were exactly equal within five of the 12 measured pairs; remaining provider
formatting/text differences changed cleanup token counts from 173/26 to 171/24.
Restricting analysis to the five identical-canonical pairs still showed no
pipeline improvement: fresh median
1.487 seconds, shared median 1.562 seconds, shared won 2/5 pairs, median paired
saving -0.084 seconds. No transcript differences are printed or persisted.

Do not compare these absolute
times to the earlier fast-mode experiment: the fixture and provider conditions differ.
The benchmark does not establish a new real-dictation release-to-insertion time.

## Repeating the approach

Recreate a temporary harness using the method above; the experimental code has
been removed. The existing `make-task6-speech.ps1` can generate the source audio,
which must then be normalized to the stated PCM16 mono layout. Regeneration on
another Windows voice/runtime may produce different audio.

This protocol performs 52 billable synthetic requests. The actual experiment ran
as the Windows user outside the sandbox to access the saved credential; no
credential was exported. Compare matching round IDs after excluding the initial
pipelines. Use the midpoint average for even-sized medians and analyze pairs with
identical canonical output separately.

## Verification

- During the experiment, 30 regular native tests passed; nine opt-in probes skipped.
- Four temporary local transport regressions verified request credential isolation, concurrent
  worker ownership, redirect refusal followed by a healthy request, and stale
  pool-generation invalidation. Local loopback sockets did not reuse reliably,
  so these tests did not require reuse where Windows/server policy may decline it.
  These four tests and the opt-in session-reuse probe were removed with the harness.
- 29 focused frontend transcription/recovery and key-privacy checks passed.
- Rust formatting and the native debug build passed after restoring production.
- The 52 real requests completed without provider/parser failures; preservation,
  recognition, and returned-tier checks passed.
- Production transport, model configuration, and insertion behavior are unchanged.
- No new physical microphone/foreground paste verification is claimed.
- After removing the experimental code, 26 regular native tests passed (eight
  opt-in probes skipped), and Rust formatting and the native debug build passed.
