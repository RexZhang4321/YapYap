# Cleanup fast-mode experiment

Measured October 5, 2026 (America/Los_Angeles).

## Change and decision

Cleanup now explicitly sends `service_tier: "fast"` to GPT-6 Luna. The model,
instructions, `reasoning.effort: "none"`, output cap, WinHTTP transport,
preservation guard, and canonical fallback are unchanged. Keep this change:
fast processing reduced median latency for every tested transcript length.

The experimental latency benchmark test has been removed. The production fast
tier, payload regression assertion, and existing cleanup probe remain.

Fast mode has higher token pricing. This is an API processing tier, independent
of reasoning effort. See the official [Fast mode guide](https://developers.openai.com/api/docs/guides/fast-mode)
and [Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Method

- Use the app's saved Windows credential and production native HTTPS transport.
- Send three fixed synthetic English transcripts: short, medium, and long.
  The exact fixture text is preserved below.
- Make six paired rounds per fixture, alternating standard/fast request order.
  Each pair uses the same fixture and differs only in `service_tier`.
- Pin the baseline to `default` (standard); the old production request omitted
  this field and therefore could inherit an account/project default.
- Exclude two initial short-text warmups, one per tier. Analyze 36 requests:
  18 per tier, six per fixture/tier. All requests run serially.
- Time credential lookup plus native request through complete response receipt.
  Payload construction and response parsing/guard checks are outside the timer.
  No connection reuse, audio processing, frontend IPC, or insertion changes.
- Record only timing, tier, token counts, fixed errors, and quality booleans.
  No credentials or returned transcripts are logged. Raw measurements and
  computed summaries are in [the JSON results](2026-10-05-cleanup-fast-benchmark.json).

## Results

| Fixture | Standard median | Fast median | Median reduction |
| --- | ---: | ---: | ---: |
| Short | 1.265 s | 0.723 s | 42.8% |
| Medium | 1.532 s | 0.981 s | 36.0% |
| Long | 2.188 s | 1.773 s | 19.0% |

Fast won 17 of 18 pairs. Median paired saving across all fixtures was 0.480 s.
Every measured response returned the requested tier, passed the preservation
guard, removed the fixture's hesitation tokens, and produced changed text.
There were no request/parser failures or tier downgrades. Slight output-token
variation remained: standard/fast generated approximately 15–16, 55–56, and
189–191 tokens for the three fixtures.

Pooled nearest-rank p95 was 3.032 s standard and 2.352 s fast. With only 18
samples per tier, this statistic equals each tier's observed maximum and is
not a reliable estimate of production tail latency. The JSON also includes
per-fixture descriptive p95 and pooled medians; use paired savings and
per-fixture medians to interpret the improvement.

This is one short synthetic API experiment, not a full microphone corpus or
semantic-equivalence evaluation. It does not measure total release-to-insertion
latency. On similar inputs, saving roughly half a second in cleanup should
reduce that total by roughly half a second if the other stages stay constant;
the app's timing display must confirm this on actual dictations. Full Task 13
corpus evaluation remains pending.

## Repeating the approach

The experimental test harness has been removed. To repeat the comparison, create
an isolated temporary harness that uses the production cleanup payload and native
transport, changes only `service_tier` between `default` and `fast`, and follows
the paired order and timing boundaries described above.

This protocol makes 38 billable synthetic requests. Exclude warmups, group by
fixture and requested tier, and compare pairs with the same fixture/round. Median
is the midpoint average for even counts; p95 uses nearest rank `ceil(0.95 * n)`.
Log only the timing, tier, token counts, fixed errors, and quality booleans listed
in the method. The saved Windows credential is accessed without exporting it.

The original run used the Windows user outside the sandbox because the sandbox
could not see the saved credential (`key_missing`). The sandbox linker required
TEMP/TMP redirected to the ignored workspace `target/benchmark-tmp` directory.

## Synthetic fixtures

**Short**

```text
um please send the draft tomorrow and do not delete it
```

**Medium**

```text
um please send the draft tomorrow and do not delete it the budget is 17.50 and the reference is user_id keep both values exactly as written uh we should review the changes before the release and confirm that the original words are still available
```

**Long**

```text
um please send the draft tomorrow and do not delete it we should review the changes before the release and confirm that the original words are still available the recording includes a short introduction followed by several details about the proposed schedule uh the first step is to collect a small set of examples the next step is to run the same examples through each configuration and compare the time required to finish we should include short messages longer paragraphs numbers and technical identifiers the budget is 17.50 and the reference is user_id keep both values exactly as written do not change the order of these steps and do not add any new information erm once the results are available please record the typical delay and the slowest observed requests we can then decide whether this change is useful before starting another experiment keep the original transcript available in case the cleanup fails and make sure that every substantive word remains in the final result
```

## Verification

- During the experiment, 26 regular native tests passed; eight opt-in probes were skipped.
- 29 focused frontend transcription/recovery and key-privacy tests passed.
- Rust formatting and the native debug build passed.
- The real benchmark completed 38 calls, including the two excluded warmups.
- No new physical microphone/foreground paste verification is claimed.
- After removing the benchmark test, 26 regular native tests passed (seven
  opt-in probes skipped), along with Rust formatting and the native debug build.
