
## Product goal

Build a privacy-oriented desktop dictation tool similar in interaction model to Whispr Flow, but using the user's own API key and communicating directly with model providers.

The product should provide near-real-time transcription in an overlay while speaking, then insert a more accurate, cleaned-up version when dictation ends.

Develop and verify on Windows first. Confirm whether macOS is required for the initial release, and track its platform checks separately.

Prove the single-segment experience before adding VAD and incremental transcription for the full P0 pipeline. Choose the stack, test devices, hotkey fallback, and audio-buffer policy before implementation.

Priority definitions:

- **P0 — MVP:** Required for the product to be useful.
    
- **P1 — Important:** Strongly improves daily usability but can follow the MVP.
    
- **P2 — Enhancement:** Valuable optimization or advanced feature.
    

### P0 — Core dictation experience

1. **Global push-to-talk hotkey**
    
    - User can start dictation from any application using a configurable global hotkey.
        
    - Prefer hold-to-talk: releasing the hotkey ends dictation. Use toggle-to-record as the initial fallback if the platform probe requires it.
        
    - Dictation must work regardless of which application currently has focus.
        
2. **Local microphone capture**
    
    - Capture microphone audio locally.
        
    - Keep original audio temporarily until final transcription succeeds or the user explicitly discards it; retain it for retry when transcription fails.
        
    - Audio should not pass through any third-party dictation service.
        
3. **BYOK API configuration**
    
    - User supplies their own OpenAI API key.
        
    - API key is stored securely using the operating system's credential/keychain mechanism.
        
    - Audio communicates directly between the local application and OpenAI. Keep StreamingSTT, FinalSTT, and CleanupModel behind small interfaces from the start; verify model access in real API probes.
        
4. **Near-real-time transcription**
    
    - Stream microphone audio to `gpt-live-transcribe`.
        
    - Display transcription updates while the user is speaking.
        
    - Optimize for low perceived latency rather than treating this output as authoritative.
        
5. **Floating transcription overlay**
    
    - Show live transcription in a small floating UI rather than continuously editing the foreground application.
        
    - Clearly treat live text as provisional.
        
    - Overlay should remain unobtrusive and avoid stealing focus. Show listening, processing, finalizing, completed, and error states. Hide after success; keep recovery accessible until errors are resolved or the session is discarded.
        
6. **Local original-audio buffer**
    
    - Preserve original microphone audio independently of Live Transcribe output.
        
    - Final transcription must be based on the original audio, not on the live transcript. Document whether the chosen buffer supports API-failure recovery only or also crash recovery.
        
7. **Voice activity / silence detection**
    
    - Detect meaningful pauses or utterance boundaries.
        
    - Divide long dictation sessions into manageable speech segments.
        
    - Avoid requiring the user to manually create sentence boundaries. Set a maximum segment duration for continuous speech; verify audio coverage separately from lost or duplicated transcript words at boundaries.
        
8. **High-accuracy transcription pass**
    
    - Send completed speech segments to `gpt-transcribe`.
        
    - Treat GPT-Transcribe output as the canonical transcription.
        
    - Allow previously displayed live transcription to differ from this result.
        
9. **Incremental final transcription**
    
    - When a speech segment is completed, begin its GPT-Transcribe pass immediately rather than waiting until the entire recording ends.
        
    - Accumulate completed canonical segments during long dictation sessions.
        
    - Aim for only the final unfinished segment to remain at stop. Bound concurrency, define backlog handling, and preserve ordering through retries and out-of-order completion; never silently insert an incomplete transcript.
        
10. **Final text cleanup**
    
    - Default to light cleanup, with a bypass that uses the canonical transcript. After canonical transcription is available, send the complete text through `gpt-5.6-luna`.
        
    - Cleanup should:
        
        - remove filler words;
            
        - remove accidental repetitions;
            
        - resolve obvious false starts;
            
        - improve punctuation and capitalization;
            
        - correct grammar appropriate for written language;
            
        - preserve the user's meaning;
            
        - preserve tone;
            
        - preserve numbers;
            
        - preserve technical terminology;
            
        - preserve filenames, identifiers, URLs, code, and product names;
            
        - avoid introducing new information.
            
11. **Fast finalization**
    
    - Releasing the dictation hotkey should result in final text appearing with minimal additional delay.
        
    - Segment-level transcription should happen concurrently during recording wherever possible to reduce end-of-recording latency. Measure total latency including backlog and whole-session cleanup against the whole-recording baseline.
        
12. **Insert final text into foreground application**
    
    - Remember which application/input had focus when dictation began.
        
    - On completion, insert the cleaned final text at the intended cursor position. If app switching, cursor movement, or a closed target makes the destination uncertain, retain the result and offer Copy.
        
    - Initial implementation may use clipboard + simulated paste.
        
    - Restore/preserve clipboard contents where practical without overwriting a newer user copy.
        
13. **Failure safety**
    
    - If cleanup fails, use the canonical GPT-Transcribe result.
        
    - If GPT-Transcribe fails, allow the user to recover/use the Live Transcribe result.
        
    - Never silently discard dictated text because one downstream stage fails.
        
    - Provide Copy original transcript and retain canonical text for the session until explicit discard; richer comparison UI can follow.
        
    - Define recording, finalizing, ready, inserted, failed, and discarded states. Handle cancellation, late responses, and new dictations during finalization without duplicate insertion.
        
14. **Privacy defaults**
    
    - Do not permanently retain recordings by default.
        
    - Delete temporary audio after successful finalization or explicit discard. Define finalization as a usable text result safely inserted or retained for recovery; failed transcription must keep its retry audio under the chosen buffer policy.
        
    - Do not send audio/transcripts anywhere except providers explicitly configured by the user.
        
    - No analytics or ordinary logs containing dictated text, audio, or credentials. Apply privacy and recovery behavior with each capability; later hardening verifies the complete lifecycle.
        

### P1 — Daily-use quality

15. **Personal vocabulary**
    
    - Maintain a local custom dictionary of names and specialized terminology.
        
    - Example terms could include technical identifiers such as `MicroDuck`, `Dynamixel`, `XL330`, `SimpleFOC`, and `AS5047P`.
        
    - Supply relevant terms as transcription context/keyword hints.
        
16. **Application-aware context**
    
    - Detect the foreground application.
        
    - Use different transcription/cleanup context for environments such as:
        
        - VS Code / terminal;
            
        - Slack / Teams;
            
        - email;
            
        - browser;
            
        - documents.
            
17. **Developer-context injection**
    
    - When dictating into development tools, optionally collect local contextual hints such as:
        
        - repository name;
            
        - open filenames;
            
        - project vocabulary;
            
        - common identifiers.
            
    - Use these only as transcription hints.
        
    - Make this behavior transparent and configurable.
        
18. **Context-sensitive cleanup**
    
    - Cleanup behavior should depend on destination.
        
    - Examples:
        
        - chat: conversational;
            
        - email: polished prose;
            
        - code/editor: preserve technical syntax and identifiers;
            
        - search box: minimal rewriting.
            
19. **Undo**
    
    - Provide an immediate way to undo the last inserted dictation.
        
    - Preserve the raw canonical transcript long enough to recover from undesirable cleanup.
        
20. **Raw vs cleaned comparison UI**
    
    - Add richer inspection and comparison of canonical and cleaned text beyond the P0 Copy original transcript action.
        
    - Cleanup must never irreversibly destroy the original transcription during the session.
        
21. **Recording state feedback polish**
    
    - Refine the P0 state indicators:
        
        - listening;
            
        - processing;
            
        - finalizing;
            
        - completed;
            
        - error.
            
22. **Configurable cleanup level**
    
    - Extend the P0 light-cleanup and bypass options with polished dictation:
        
        - verbatim;
            
        - light cleanup;
            
        - polished dictation.
            
    - Default should preserve wording while removing normal spoken-language artifacts.
        
23. **Configurable hotkeys**
    
    - Allow push-to-talk and toggle-to-record behavior.
        
    - Avoid common OS/application shortcut conflicts.
        
24. **Microphone selection**
    
    - Allow explicit microphone selection.
        
    - Remember the preferred microphone.
        
    - Gracefully handle devices being disconnected.
        
25. **Basic usage/cost visibility**
    
    - Track approximate transcription minutes and token usage locally.
        
    - Give users visibility into estimated API consumption without sending usage telemetry elsewhere.
        

### P2 — Advanced features

26. **True inline live transcription**
    
    - Optionally insert provisional text directly into applications while the user speaks.
        
    - Support safely replacing/revising recent provisional text.
        
    - This should not be part of the initial MVP because application editing semantics are significantly more complicated than using an overlay.
        
27. **Adaptive vocabulary**
    
    - Learn frequently corrected words and technical terms locally.
        
    - Suggest adding repeatedly encountered terms to the user's vocabulary.
        
28. **Per-application profiles**
    
    - Define specific cleanup prompts, vocabulary, formatting, and behavior for individual applications.
        
29. **Formatting voice commands**
    
    - Recognize explicit commands such as:
        
        - "new paragraph";
            
        - "bullet list";
            
        - "delete that";
            
        - "scratch that";
            
        - "quote";
            
        - "code block".
            
    - Separate intentional commands from literal dictated speech.
        
30. **Selection-aware rewriting**
    
    - If text is selected when dictation starts, optionally interpret speech as an instruction to modify that text rather than append new text.
        
31. **Additional provider support**
    
    - Add providers behind the STT and cleanup interfaces established in P0.
        
    - Initial supported stack remains:
        
        - Live: `gpt-live-transcribe`;
            
        - Canonical STT: `gpt-transcribe`;
            
        - Cleanup: `gpt-5.6-luna`.
            
32. **Offline/local model support**
    
    - Potential future support for local STT or cleanup models.
        
    - Not required for the initial BYOK OpenAI implementation.
        
33. **History**
    
    - Optional local-only history of recent dictations.
        
    - Disabled by default or explicitly user-controlled because of privacy considerations.
        
34. **Cross-device settings sync**
    
    - Optional synchronization of vocabulary, prompts, and preferences.
        
    - Never synchronize dictated content unless explicitly enabled.
        

## Evaluation targets

Use real probes to set typical and slow-case latency targets. Before segmentation, save a small corpus covering short/long speech, corrections, numbers, identifiers, and intended languages. Compare first-visible-text and release-to-insertion latency, canonical accuracy, cleanup meaning changes, and total API cost against the whole-recording baseline.

## Initial processing pipeline

`Microphone → Local audio buffer → GPT-Live-Transcribe → Live overlay`

In parallel:

`Local audio buffer → VAD utterance boundaries → GPT-Transcribe → Canonical transcript accumulator`

When recording ends:

`Canonical transcript → GPT-5.6-Luna cleanup → Insert into foreground application`

The original audio should remain the source of truth for transcription. Live transcription exists primarily to provide immediate feedback. The first integration uses the complete recording as one segment; VAD and incremental canonical transcription follow the measured baseline.

## Explicit MVP non-goals

The first version does **not** need:

- direct inline live editing inside arbitrary applications;
    
- offline speech recognition;
    
- long-term audio storage;
    
- cloud account/sync infrastructure;
    
- multi-provider support;
    
- sophisticated voice commands;
    
- autonomous rewriting beyond conservative dictation cleanup.
    

The MVP should prove one interaction exceptionally well:

**Hold hotkey → speak → see words almost immediately → release → receive an accurate, cleaned-up version at the cursor.**