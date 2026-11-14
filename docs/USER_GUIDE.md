# Using YapYap

How to set up, dictate and recover your words. Shortcuts are shown for Windows; on a Mac the app shows the equivalent Command/Option keys.

## Set up once

1. Open **Settings** or choose **Set up dictation** from the readiness screen.
2. Paste your OpenAI API key and choose **Save key**. The masked field clears immediately. The key stays in Windows Credential Manager or the macOS Keychain; the application reads only its presence on launch. **Check connection** is optional and makes no recording upload.
3. Allow microphone access when prompted. The application checks readiness automatically after a key is saved. If access is blocked, Settings explains the problem and offers **Allow microphone** to retry. Choose a microphone or leave the system default selected.
4. Keep the default `Ctrl+Alt+F8`, or choose **Record shortcut**, then press and release your key combination to save it automatically. Esc cancels shortcut recording. A conflict leaves the previous shortcut available. Microphone selection, shortcut, live preview, and cleanup preferences are remembered on this user account.

## Dictate from the tray

Place the cursor in the intended text field, hold the shortcut, and speak. The passive floating window shows Listening and provisional live words. Release the shortcut to transcribe the complete recording, optionally tidy the text, and insert it. Keep the intended destination/cursor unchanged while the result finishes. A successful insertion hides the floating window, and you can dictate again without discarding the previous result.

Press **Esc** while recording or finalizing to cancel before insertion is dispatched, or open **YapYap** from the tray and choose **Cancel dictation**. If another application prevents global Esc registration, the app shows that limitation and keeps the Cancel button available. Cancel clears the current session's local audio/text and unlocks the local session immediately; late responses are ignored. An already sent native request can still finish in the background. If a new transcription reaches its native busy guard, the app retains the new recording and explains how to retry shortly. A paste already dispatched cannot be cancelled.

**Show live words** and **Light cleanup** are in Settings. Live words are a preview; the final transcript always uses the original recording. Turn cleanup off to insert the original transcript. Cleanup failure uses the original words. Audio and transcripts go directly to OpenAI; no dictation service or analytics receives them.

## Recover your words

The main window shows the specific issue and recovery actions while processing, after failure, and when clipboard restoration fails. Failed transcription retains audio for **Retry transcription** and playback. **Download WAV** explicitly saves the current recording to Downloads; the file remains there after the session ends. If insertion is refused before any paste, or destination capture fails, focus your intended text field and press and release your shortcut again. This explicitly chooses that input and pastes the saved output without recording, retranscribing, or repeating cleanup. The input must remain unchanged during this retry's native checks. The alert includes the native refusal reason. An uncertain or partially dispatched paste cannot be retried with the shortcut; check the destination and use Copy for manual recovery. **Discard dictation** clears the current sources and dismisses its floating alert; it cannot retract an existing paste or remove a downloaded file.

While processing, **Stop waiting · keep recovery** immediately unlocks the local session and preserves the recording or original transcript. **Skip cleanup · review original…** shows the exact canonical original with an unpolished-text warning. **Use live words · review…** shows the exact provisional snapshot and warns that it may be incomplete, contain gaps or recognition errors, and is not the final transcript. **Confirm and copy** stops waiting and copies only the displayed text. Return to the intended field and press Ctrl+V to paste manually. Dismissing the dialog keeps waiting and does not copy or cancel anything. Provisional text is never promoted to canonical text or passed to automatic insertion. **Copy live words** after failure uses the same confirmation.

After 12 seconds, a stalled stage shows an actionable alert. Final transcription has a 100-second frontend deadline and preserves retry audio on timeout. Cleanup has a 30-second deadline and falls back to the original. Destination capture and insertion waits are bounded; a timed-out paste is treated as an uncertain outcome and cannot be automatically retried.

**Copy original** and **Original transcript** keep the canonical words available separately from cleanup. Earlier successful results move into **Saved for this session** as you dictate again; each can be copied or discarded. These results exist only in memory. Discard and quitting clear them; there is no permanent history or crash recovery.

Copy preserves supported clipboard contents for **Restore previous clipboard**. If preservation fails, **Clipboard options** offers an explicit **Replace clipboard** action. A newer user copy is not overwritten by automatic clipboard restoration.

## Processing phases

The main window's **Processing phases** controls independently enable **Full audio transcription** and **gpt-6-luna cleanup**. Both default to on and your choices persist. Turning full audio transcription off uses the completed live transcript, enables live transcription for that mode, and skips the full-recording upload. Cleanup can tidy either transcript; turning it off inserts the received words directly. A failed or gapped live stream keeps the recording for **Retry full audio transcription**, which explicitly runs the full-recording pass. Unfinished live words are never inserted automatically.
