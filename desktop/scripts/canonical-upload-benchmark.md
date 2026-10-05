# Upload-before-release transcription experiment

Measured October 5, 2026 (America/Los_Angeles), against baseline `f930d71`.

## Decision

Do not enable upload-before-release with `gpt-transcribe` in the application.
The candidate improved release-to-cleaned-result time in only 2/10 measured
pairs, with a median paired saving of **-0.169 seconds**. The longer-recording
transcription result suggested a small possible benefit, but total pipeline
latency did not improve consistently. This sample does not justify adding the
stream lifecycle and fallback complexity to production.

The candidate and temporary benchmark hooks were removed after measurement.
Only this written method/results record is retained in version control. The
production file transport, live preview, Luna fast tier, recovery, and insertion
behavior remain unchanged.

## Approach

The candidate reused the native authenticated WebSocket transport with a
`gpt-transcribe` transcription session. It omitted the live model's `delay`
setting, disabled automatic turn detection, sent PCM16 mono audio chunks during
recording, and committed the complete turn on release. Only the provider's final
completion event supplied the transcript. No preview deltas entered cleanup.

The comparator used the production whole-file `gpt-transcribe` request after
release. Both arms requested the same Luna fast-mode cleanup with the production
prompt, reasoning setting, output limit, parser, and word-preservation guard.
The candidate was implemented and exercised in a temporary native harness before
changing the application's finalization flow.

The official [Realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription#transcribe-a-committed-turn)
allows `gpt-transcribe` over WebSocket but states that transcription begins after
the audio turn is committed. This experiment therefore moved connection setup
and upload before release; it did not move model inference before release.

## Benchmark protocol

- Generate fixed synthetic System.Speech audio saying: "Hello from the dictation
  test. The meeting starts at three thirty. Please save the project tomorrow."
  Use the existing `make-task6-speech.ps1`, normalize its WAV header, and resample
  once from 16 kHz to 24 kHz with linear interpolation. Give both arms identical
  24 kHz PCM16 mono audio; do not compare differently resampled inputs.
- Short recording: 7.690 seconds, 369164 WAV bytes, SHA256
  `3aeb5c89882f745c60e4e6b8fcf935fc4c1f67e02a14b530125fd3b18c670fcf`.
- Longer recording: repeat the short PCM sequence three times, retaining one WAV
  header: 23.070 seconds, 1107404 bytes, SHA256
  `ca142ea76503b5c750d683bee6d0f9e98c1c3bfe61e784a5f9bd6aa0259c6385`.
  This tests upload duration, not additional linguistic diversity.
- Replay audio at microphone speed. Begin the streaming connection at capture
  start and enqueue chunks only as their samples become available: at most
  9600 bytes / 200 ms per append. Retain the bounded native queue. The baseline
  waits the same recording duration before making its whole-file request.
- Start post-release timing immediately after the final chunk becomes available.
  Streaming timers include remaining queue drain, commit, and final completion;
  file timers include credential lookup, multipart construction, upload, and
  parsing. Then clean up each arm's actual final transcript and measure total
  release-to-cleaned-result time. Stop timing before socket teardown completes.
- Exclude two initial short-recording pipelines, one per arm. Measure six
  alternating-order short pairs, then one further short pair and three longer
  pairs with additional quality/readiness instrumentation: ten measured pairs,
  two excluded initial pipelines, 44 billable requests in total.
- Compare matching pairs and use midpoint-average medians. Persist only timing,
  recognition/preservation booleans, text byte counts, canonical equality,
  normalized word error rates, connection readiness, and queue counts. No keys,
  returned text, audio from a microphone, or network addresses are logged.
- For the instrumented follow-up, normalize case, punctuation, and `3:30` /
  `3.30` to "three thirty" before computing word error rate against the fixed
  synthetic reference. Initial keyword checks did not normalize numeric times;
  their false results are not evidence of substantive recognition errors.

## Results

| Recording | Stage | File median | Streaming median | Streaming pair wins | Median paired saving |
| --- | --- | ---: | ---: | ---: | ---: |
| 7.690 s (7 pairs) | Final transcription | 0.476 s | 0.732 s | 2/7 | -0.230 s |
| 7.690 s (7 pairs) | Transcription + cleanup | 1.340 s | 1.764 s | 1/7 | -0.365 s |
| 23.070 s (3 pairs) | Final transcription | 1.074 s | 0.920 s | 2/3 | +0.044 s |
| 23.070 s (3 pairs) | Transcription + cleanup | 2.202 s | 2.002 s | 1/3 | -0.059 s |

Pooled across all ten pairs, final-transcription medians were 0.749 s file /
0.867 s streaming, and pipeline medians were 1.664 s file / 1.845 s streaming.
Streaming won 4/10 transcription pairs and 2/10 full-pipeline pairs. Median
paired savings were -0.153 s and -0.169 s, respectively. Pooling different
recording lengths is descriptive only; use the within-length paired results
when interpreting this experiment.

The longer-recording pooled medians look favorable to streaming, but streaming
lost two of its three full-pipeline pairs. The difference between pooled medians
and median paired savings reflects request-to-request variability; neither is
strong evidence of a production improvement with this sample size.

In the original six short pairs, streaming won 1/6 transcription pairs and 0/6
pipeline pairs. File/streaming pipeline medians were 1.281/1.690 s, and median
paired saving was -0.388 s. Four pairs had byte-identical canonical text; in that
subset streaming won no transcription or pipeline pairs. The follow-up short
pair favored streaming, showing why cloud timing needs paired repeated checks.
All three longer pairs had byte-identical canonical text.

The instrumented four-pair follow-up produced zero normalized word error rate
for all eight transcripts and passed keyword checks. This explicitly accounts
for numeric time formatting, which the original raw keyword checker did not.
All 22 pipelines completed without provider/parser failures, and every cleanup
passed the production preservation guard. Fast tier was requested for every
cleanup; this harness did not separately inspect the returned tier.

The four instrumented streaming sessions acknowledged configuration 0.323-0.545 s
after capture began, well before release. At release, one audio chunk remained
queued, corresponding to the final chunk just produced. Queue consumption does
not prove server receipt, but it confirms the harness was not merely buffering
the whole recording until release. Remaining send/commit latency was included
in the measured result.

## Limits

This is a small cloud-latency experiment on synthetic speech. Endpoint and output
formatting differences can affect timing even with the same model. Exact
canonical equality is checked separately; cleanup always uses the actual result.
No broad accuracy claim follows from the fixed-reference checks.

The replay harness bypasses frontend IPC, browser microphone startup, worklet
flush, WAV encoding, destination checks, and insertion. It measures native
release-to-result latency, not the complete UI's release-to-insertion time. The
live preview connection was not run alongside the candidate; the candidate's
startup costs were overlapped with capture rather than included after release.
No new physical microphone or foreground-paste verification is claimed.

The original synthetic WAV remains available to the comparator throughout each
run. No application recovery or insertion behavior was changed for this native
experiment. Future application integration would need explicit coverage for
stream failure, byte-identical file fallback, cancellation, and stale results.

## Verification and repetition

The candidate passed the 26 existing regular native tests and completed 44
synthetic API requests using the saved Windows credential without exporting it.
After removal, all 26 regular native tests passed (seven opt-in probes skipped),
along with Rust formatting and the native debug build. No paid benchmark harness
or test-only source reference remains.

To repeat this experiment later, build a disposable harness following the
protocol above. Preserve bounded queues and native TLS/credential handling,
record only fixed metadata, alternate request order, and measure from simulated
release rather than from connection startup. Extend the real-audio corpus before
claiming a latency or accuracy improvement. The original run's synthetic fixtures
and logs were generated under the ignored Cargo target directory.
