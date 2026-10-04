# Task 11 conservative cleanup verification

Recorded October 3, 2026 (America/Los_Angeles).

## Intended behavior

The complete original recording supplies canonical final STT. Cleanup operates once on that canonical transcript, with the original retained until explicit discard or app exit. A separate cleaned result supplies insertion; bypass or cleanup failure uses canonical text. Retrying a refused insertion uses the same selected text and does not make another provider request. Cancellation suppresses late cleanup results and paste, while a sent native request keeps the session locked until it completes.

Cleanup uses the saved credential internally with native HTTPS to OpenAI. The request uses `gpt-5.6-luna`, separate instructions/user input, `store: false`, no tools or application context, and `reasoning.effort: none`. Only a complete usable assistant-text response may be accepted. Fixed errors and bounded payloads prevent raw provider bodies from entering the UI or ordinary logs. `store: false` disables Responses storage; it is not a claim about every provider retention policy.

The prompt requests minimal punctuation, capitalization, whitespace and standalone filler cleanup without rewriting meaning or tone. A conservative lexical guard rejects changed content/order and protected numeric/technical tokens. It deliberately prefers canonical fallback to more ambitious cleanup. Punctuation can still affect meaning; these constraints do not prove semantic equivalence. The canonical transcript and bypass remain the recovery path. Representative accuracy/latency/cost evaluation remains Task 13.

Official API references reviewed for this implementation: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [text generation and Responses output](https://developers.openai.com/api/docs/guides/text), and [stateless requests](https://developers.openai.com/api/docs/guides/conversation-state).

## Manual Windows follow-up

1. Prepare the microphone, enable cleanup and focus a disposable input. Dictate an ordinary sentence with fillers and punctuation. Release and compare inserted text with the retained canonical transcript; use Copy original transcript and restore the previous clipboard.
2. Disable cleanup before a new session and confirm canonical text inserts exactly. Cleanup settings are fixed for an active session.
3. Dictate numbers, technical identifiers, paths, URLs and filenames. Compare originals; rejected edits should visibly fall back to canonical text.
4. Cancel while cleanup is pending and verify no late result or paste. Start another dictation only after the outstanding request finishes. Change the destination during cleanup and verify safe Copy/refused-insertion recovery.

No fresh physical-microphone, full-key-hold or combined foreground-application UI pass is claimed in this note. Task 10's desktop automation timeout remains a combined-flow verification gap.

## Observed checks

- 47 frontend tests and the TypeScript/Vite production build passed. New checks cover cleaned insertion with exact original retention, session-snapshotted bypass, malformed/failed cleanup fallback, late success/failure after cancellation, unavailable destinations and insertion retry without duplicate provider work.
- 25 regular native tests passed (seven opt-in helpers skipped). Five cleanup tests passed again after preservation fixes. Native debug build and Rust formatting passed. Parser checks cover complete statuses, known reasoning items, refusals/tools/extra output, malformed responses and size/control limits. Preservation fixtures cover negations, word order/additions, technical casing, URLs/email/paths/files, signed and leading-dot numbers, hidden filenames, contractions, quoted fillers, operators and emoji.
- The explicit saved-key probe initially returned `key_missing` in the sandbox. Running it as the actual Windows user succeeded. The final real request uploaded only `um hello world`; fixed booleans reported changed=true, fillerRemoved=true, nonempty=true and wordsPreserved=true. The final request completed in 1.79 seconds; this is a single synthetic request observation, not a dictation latency target or corpus evaluation. No key/provider response/transcript was printed.
- Four privacy-scanner regression tests and the pattern-only audit passed (105 files/build outputs, 379 Git objects at that check). No saved-key comparison is claimed for that pattern-only audit. Source review found no new text/audio/credential logging or persistence.
- Full UI, physical microphone and foreground-application integration follow-ups remain listed above; no new combined UI pass is claimed.
