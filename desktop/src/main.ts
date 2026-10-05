import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { encodeWav, microphoneErrorMessage, PcmRecorder, type CapturedPcm } from "./audioCapture";
import { initializeApiKeySettings } from "./apiKey";
import { TranscriptionSession, type InsertionResult } from "./transcriptionSession";
import { transcriptionError } from "./transcription";
import { LiveTranscription } from "./liveTranscription";
import { nativeStreamingSTT } from "./liveTransport";
import { OverlayController, overlayPhase, type OverlaySnapshot } from "./overlayState";
import { selectProvisionalText } from "./provisionalRecovery";
import { shortcutFromKey, ShortcutBinding, ScopedShortcut } from "./shortcuts";
import { initializeSurface } from "./uiSurface";
import { confirmRecoveryCopy, type RecoveryCopyChoice } from "./recoveryCopy";

type HotkeyAction = "record" | "live" | "insert" | "retry";

const shortcutInput = document.querySelector<HTMLInputElement>("#shortcut")!;
const status = document.querySelector<HTMLElement>("#status")!;
const holdState = document.querySelector<HTMLElement>("#hold-state")!;
const events = document.querySelector<HTMLOListElement>("#events")!;
const insertionStatus = document.querySelector<HTMLElement>("#insertion-status")!;
const restoreButton = document.querySelector<HTMLButtonElement>("#restore-clipboard")!;
const actionSelect = document.querySelector<HTMLSelectElement>("#hotkey-action")!;
const microphoneSelect = document.querySelector<HTMLSelectElement>("#microphone")!;
const refreshDevicesButton = document.querySelector<HTMLButtonElement>("#refresh-devices")!;
const prepareMicrophoneButton = document.querySelector<HTMLButtonElement>("#prepare-microphone")!;
const inputLevelMeter = document.querySelector<HTMLMeterElement>("#input-level")!;
const inputLevelStatus = document.querySelector<HTMLElement>("#input-level-status")!;
const recordingStatus = document.querySelector<HTMLElement>("#recording-status")!;
const recordingMetadata = document.querySelector<HTMLElement>("#recording-metadata")!;
const recordingPlayback = document.querySelector<HTMLAudioElement>("#recording-playback")!;
const playRecordingButton = document.querySelector<HTMLButtonElement>("#play-recording")!;
const stopPlaybackButton = document.querySelector<HTMLButtonElement>("#stop-playback")!;
const clearRecordingButton = document.querySelector<HTMLButtonElement>("#clear-recording")!;
const transcribeButton = document.querySelector<HTMLButtonElement>("#transcribe-recording")!;
const discardButton = document.querySelector<HTMLButtonElement>("#discard-transcription")!;
const transcriptionStatus = document.querySelector<HTMLElement>("#transcription-status")!;
const transcriptView = document.querySelector<HTMLTextAreaElement>("#transcript")!;
const sessionState = document.querySelector<HTMLElement>("#session-state")!;
const copyTranscriptButton = document.querySelector<HTMLButtonElement>("#copy-transcript")!;
const copyTranscriptWithoutBackupButton = document.querySelector<HTMLButtonElement>("#copy-transcript-without-backup")!;
const copyOriginalButton = document.querySelector<HTMLButtonElement>("#copy-original")!;
const copyOriginalWithoutBackupButton = document.querySelector<HTMLButtonElement>("#copy-original-without-backup")!;
const cleanupEnabled = document.querySelector<HTMLInputElement>("#cleanup-enabled")!;
const cleanedTranscriptView = document.querySelector<HTMLTextAreaElement>("#cleaned-transcript")!;
const cleanupStatus = document.querySelector<HTMLElement>("#cleanup-status")!;
const applyShortcutButton = document.querySelector<HTMLButtonElement>("#shortcut-form button")!;
const liveEnabled = document.querySelector<HTMLInputElement>("#live-enabled")!;
const liveView = document.querySelector<HTMLTextAreaElement>("#live-transcript")!;
const liveStatus = document.querySelector<HTMLElement>("#live-status")!;
const liveLatency = document.querySelector<HTMLElement>("#live-latency")!;
const liveReconnect = document.querySelector<HTMLButtonElement>("#live-reconnect")!;
const copyProvisionalButton = document.querySelector<HTMLButtonElement>("#copy-provisional")!;
const copyProvisionalWithoutBackupButton = document.querySelector<HTMLButtonElement>("#copy-provisional-without-backup")!;
const provisionalCopyStatus = document.querySelector<HTMLElement>("#provisional-copy-status")!;
const overlayStatus = document.querySelector<HTMLElement>("#overlay-status")!;

const shortcutRecordButton = document.querySelector<HTMLButtonElement>("#shortcut-record")!;
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-dictation")!;
const dictationStatus = document.querySelector<HTMLElement>("#dictation-status")!;
const retainedResults = document.querySelector<HTMLElement>("#retained-results")!;
const bypassButton = document.querySelector<HTMLButtonElement>("#bypass-processing")!;
const recoveryDialog = document.querySelector<HTMLDialogElement>("#recovery-confirm-dialog")!;
let recordingShortcut = false;
let shortcutBusy = false;
let escapeAvailable = true;
let apiKeyState = "unknown";
let microphoneAccess: "unknown" | "ready" | "blocked" = "unknown";
let microphoneIssue = "";
let attemptedMicrophoneAccess = false;
const preferencesKey = "byok-dictation-preferences";
function savedPreferences(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferencesKey) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
function savePreferences() {
  try { localStorage.setItem(preferencesKey, JSON.stringify({ shortcut: shortcutBinding.active,
    microphone: preferredMicrophone, cleanup: cleanupEnabled.checked, live: liveEnabled.checked })); }
  catch { status.textContent = "Settings work for this session. Windows could not save them for next time."; }
}
const preferences = savedPreferences();
let preferredMicrophone = typeof preferences.microphone === "string" ? preferences.microphone : "";
if (typeof preferences.shortcut === "string") shortcutInput.value = preferences.shortcut;
if (typeof preferences.cleanup === "boolean") cleanupEnabled.checked = preferences.cleanup;
if (typeof preferences.live === "boolean") liveEnabled.checked = preferences.live;
shortcutInput.readOnly = true;
const shortcutBinding = new ShortcutBinding(next => register(next, event => {
  if (shortcutBinding.available && shortcutBinding.active === next) onShortcut(event);
}), unregister);
const escapeBinding = new ScopedShortcut(
  () => register("Escape", event => { if (event.state === "Pressed" && canCancelDictation()) cancelDictation(); }),
  () => unregister("Escape"), available => { escapeAvailable = available; showHomeState(); },
);
let held = false;
let heldAction: HotkeyAction | null = null;
let insertionCapture: Promise<string> | null = null;
let recordingStart: Promise<string> | null = null;
let operationBusy = false;
let dictationOperation = 0;
let playbackUrl: string | null = null;
let captureInterruptionMessage: string | null = null;
let overlayCaptureReadySession = "";
let livePreviewSession = "";
const overlay = new OverlayController(
  () => invoke<OverlaySnapshot>("claim_overlay"),
  snapshot => invoke<void>("update_overlay", { snapshot }),
  failed => { overlayStatus.textContent = failed
    ? "The floating status window is unavailable. Recording and recovery remain available here."
    : "The floating window shows live words and status. Open Dictation from the tray to recover text."; },
);

function log(message: string) {
  const line = new Date().toISOString() + "  " + message;
  const item = document.createElement("li");
  item.textContent = line;
  events.prepend(item);
  console.info(line);
}

function showOverlay() {
  overlay.update(transcription.sessionId !== overlayCaptureReadySession ? "hidden" : overlayPhase({
    state: transcription.state, busy: transcription.busy, inserting: transcription.inserting,
    error: transcription.stalled ? "request_stalled" : transcription.error, insertion: transcription.insertion,
    interrupted: captureInterruptionMessage !== null && !transcription.transcript,
    stopping: operationBusy && recordingStart !== null,
  }), livePreviewSession === transcription.sessionId && liveEnabled.checked ? live : undefined);
}

function provisionalRecoveryText(allowProcessing = false): string | null {
  return selectProvisionalText({
    sessionId: transcription.sessionId, previewSessionId: livePreviewSession,
    sessionState: transcription.state, discarded: transcription.discarded,
    held, operationBusy, busy: transcription.busy, inserting: transcription.inserting,
    liveState: live.state, text: live.text,
    allowProcessing,
  });
}

function showProvisionalRecovery() {
  const unavailable = provisionalRecoveryText() === null;
  copyProvisionalButton.disabled = unavailable;
  copyProvisionalWithoutBackupButton.disabled = unavailable;
}

function showState() {
  showOverlay();
  showProvisionalRecovery();
  const cancellable = canCancelDictation();
  void escapeBinding.setActive(cancellable);
  holdState.textContent = held ? "DOWN" : "UP";
  const locked = held || operationBusy || transcription.busy;
  document.dispatchEvent(new CustomEvent("dictation-active", { detail: { active: locked } }));
  liveEnabled.disabled = locked;
  cleanupEnabled.disabled = locked;
  liveReconnect.disabled = !recorder.isRecording || live.state !== "failed";
  applyShortcutButton.disabled = locked || shortcutBusy || recordingShortcut;
  shortcutRecordButton.disabled = locked || shortcutBusy;
  shortcutInput.disabled = locked || shortcutBusy;
  actionSelect.disabled = locked;
  microphoneSelect.disabled = locked;
  refreshDevicesButton.disabled = locked;
  prepareMicrophoneButton.disabled = locked || microphoneAccess === "ready";
  prepareMicrophoneButton.hidden = microphoneAccess === "ready";
  playRecordingButton.disabled = locked || !recorder.hasPlayableRecording || !recordingPlayback.paused;
  stopPlaybackButton.disabled = locked || recordingPlayback.paused;
  clearRecordingButton.disabled = locked || !recorder.hasRecording;
  transcribeButton.disabled = locked || !transcription.audio || !recordingPlayback.paused;
  transcribeButton.textContent = "Retry transcription";
  discardButton.disabled = transcription.inserting || transcription.state === "idle" || transcription.state === "discarded";
  if (operationBusy && !recordingStart) discardButton.disabled = true;
  discardButton.hidden = held || transcription.busy || transcription.state === "recording";
  discardButton.textContent = "Discard this dictation";
  cancelButton.disabled = !cancellable;
  cancelButton.hidden = !cancellable;
  cancelButton.textContent = (transcription.busy || transcription.state === "recording" || recordingStart !== null ? "Cancel dictation" : "Discard dictation")
    + (escapeAvailable ? " · Esc" : "");
  const processingRecovery = transcription.busy && !transcription.inserting && !held && !operationBusy;
  setHidden("processing-recovery", !processingRecovery);
  const recoverable = transcription.transcript || provisionalRecoveryText(true);
  bypassButton.hidden = !processingRecovery || !recoverable;
  bypassButton.textContent = transcription.transcript ? "Skip cleanup · review original…" : "Use live words · review…";
  document.querySelector<HTMLElement>("#processing-recovery-hint")!.textContent = transcription.transcript
    ? "You can stop cleanup and copy your original transcript for manual pasting."
    : "Final transcription uses your full recording for accuracy. You can stop waiting and review the provisional live words, or keep the recording for retry.";
  copyTranscriptButton.disabled = locked || !transcription.transcript;
  copyTranscriptWithoutBackupButton.disabled = locked || !transcription.transcript;
  copyOriginalButton.disabled = locked || !transcription.transcript;
  copyOriginalWithoutBackupButton.disabled = locked || !transcription.transcript;
  const copyLabel = transcription.cleanedTranscript !== null ? "Copy cleaned" : "Copy transcript";
  copyTranscriptButton.textContent = copyLabel;
  copyTranscriptWithoutBackupButton.textContent = "Replace clipboard with text";
  sessionState.textContent = transcription.state;
  document.querySelector<HTMLButtonElement>("#copy-text")!.disabled = locked;
  document.querySelector<HTMLButtonElement>("#copy-without-backup")!.disabled = locked;
  transcriptView.value = transcription.transcript;
  cleanedTranscriptView.value = transcription.cleanedTranscript ?? "";
  cleanupStatus.textContent = transcription.cleanupWarning
    ? "Cleanup was unavailable. Your original words are used instead."
    : transcription.cleaning && !transcription.discarded ? "Tidying your words…"
    : transcription.cleanedTranscript !== null ? "Tidied text ready. Your original words are also available."
    : transcription.state !== "idle" && transcription.state !== "discarded"
      ? transcription.usesCleanup ? "Light cleanup is on."
        : "Using your original words."
      : cleanupEnabled.checked ? "Light cleanup is on for your next dictation."
        : "Your next dictation will use your original words.";
  if (transcription.discarded) {
    transcriptionStatus.textContent = transcription.busy
      ? "Cancelled. The pending response will be ignored."
      : "Dictation discarded.";
  } else if (transcription.inserting) {
    transcriptionStatus.textContent = "Inserting text. Please wait for the result.";
  } else if (transcription.busy) {
    transcriptionStatus.textContent = transcription.cleaning
      ? "Tidying your words…"
      : "Transcribing…";
  } else if (transcription.state === "recording") {
    transcriptionStatus.textContent = actionSelect.value === "live"
      ? "Listening. Release to save this test recording."
      : "Listening. Release to finish, or Esc to cancel.";
  } else if (transcription.insertion) {
    transcriptionStatus.textContent = (transcription.state === "inserted" ? "Completed. " : "") + transcription.insertion.message
      + (transcription.canRetryInsertion ? " Return to the original cursor, then press and release your shortcut to retry. You can also copy the text." : " Your original words remain here until you discard them or quit.");
  } else if (transcription.transcript && transcription.error) {
    transcriptionStatus.textContent = "Check the destination before pasting again. Your text is safe here; use Copy if needed.";
  } else if (transcription.error) {
    transcriptionStatus.textContent = transcriptionError(transcription.error) + " Retry uses your saved recording."
      + (provisionalRecoveryText() !== null ? " Live words are also available below." : "");
  } else if (transcription.transcript) {
    transcriptionStatus.textContent = "Text ready. Your original words stay here until you discard them or quit.";
  } else {
    transcriptionStatus.textContent = transcription.audio
      ? "Recording saved. Choose Retry transcription to try again."
      : actionSelect.value === "live" ? "Hold your shortcut to preview live words."
      : "Hold your shortcut in any text field. Release to insert.";
  }
  showHomeState();
  showRetainedResults(locked);
}

function canCancelDictation() {
  return !transcription.discarded && !transcription.inserting
    && !recoveryDialog.open
    && (transcription.state === "recording" || transcription.busy || recordingStart !== null
      || transcription.state === "failed" || transcription.hasResult);
}

function setHidden(id: string, hidden: boolean) {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element) element.hidden = hidden;
}

function showHomeState() {
  const active = held || operationBusy || transcription.busy;
  const ready = apiKeyState === "saved" && microphoneAccess === "ready" && shortcutBinding.available;
  const home = document.querySelector<HTMLElement>("#home-panel");
  const clipboardIssue = transcription.insertion?.pasteSent && !transcription.insertion.clipboardRestored;
  const needsAttention = transcription.state === "failed" || transcription.stalled || clipboardIssue;
  if (home) home.dataset.state = needsAttention ? "error" : held ? "recording" : active ? "active" : ready ? "ready" : "setup";
  const display = document.querySelector<HTMLElement>("#shortcut-display");
  if (display) display.textContent = shortcutBinding.active ?? "Set a shortcut";
  const setupMessage = document.querySelector<HTMLElement>("#setup-message");
  if (setupMessage) setupMessage.textContent = apiKeyState !== "saved" ? "Add your OpenAI API key in Settings to start dictating."
    : microphoneAccess === "blocked" ? microphoneIssue || "Allow microphone access in Windows settings, then retry in Settings."
    : microphoneAccess === "unknown" ? "Checking microphone access…"
    : "Choose an available dictation shortcut in Settings.";
  const accessHelp = document.querySelector<HTMLElement>("#microphone-access-help");
  if (accessHelp) accessHelp.textContent = microphoneAccess === "ready" ? "Microphone ready. It opens only while you dictate."
    : microphoneAccess === "blocked" ? microphoneIssue || "Allow microphone access, then retry."
    : "Microphone access is checked automatically after your key is saved. Allow access once when asked.";
  setHidden("setup-callout", ready || active);
  setHidden("live-panel", !((active && liveEnabled.checked && live.text !== "") || (transcription.state === "failed" && provisionalRecoveryText() !== null)));
  setHidden("recovery-panel", held || (operationBusy && !transcription.hasResult) || (!transcription.hasResult && transcription.state !== "failed"));
  liveReconnect.hidden = liveReconnect.disabled;
  const cancelHint = document.querySelector<HTMLElement>("#cancel-hint");
  if (cancelHint) {
    cancelHint.hidden = !canCancelDictation() && (!ready || active);
    cancelHint.textContent = canCancelDictation()
      ? escapeAvailable ? "Press Esc to cancel." : "Global Esc is unavailable. Use Cancel here."
      : "Press Esc while dictating to cancel.";
  }
  setHidden("audio-recovery", !transcription.audio);
  setHidden("current-result", !transcription.transcript);
  setHidden("cleaned-transcript-panel", transcription.cleanedTranscript === null);
  const originalPanel = document.querySelector<HTMLDetailsElement>("#original-transcript-panel");
  if (originalPanel && transcription.cleanedTranscript === null) originalPanel.open = true;
  setHidden("provisional-recovery", transcription.state !== "failed" || provisionalRecoveryText() === null);
  setHidden("retained-panel", transcription.retainedResults.length === 0);
  setHidden("clipboard-recovery", restoreButton.disabled);
  dictationStatus.textContent = transcription.inserting ? "Inserting text…"
    : transcription.discarded && (operationBusy || transcription.busy) ? "Cancelled"
    : transcription.busy ? transcription.stalled ? transcription.cleaning ? "Cleanup is taking longer than expected" : "Transcription is taking longer than expected"
      : transcription.cleaning ? "Tidying your words…" : "Transcribing…"
    : held ? recorder.isRecording ? "Listening" : "Opening microphone…"
    : operationBusy ? microphoneAccess === "unknown" ? "Checking microphone access…" : "Finishing…"
    : clipboardIssue ? "Text inserted · clipboard needs attention"
    : transcription.state === "failed" ? "Dictation needs attention"
    : transcription.state === "inserted" ? "Inserted"
    : transcription.audio ? "Recording ready"
    : ready ? "Ready to dictate"
    : "Setup needed";
  const detail = document.querySelector<HTMLElement>("#dictation-detail");
  if (detail) {
    detail.textContent = transcription.discarded && (operationBusy || transcription.busy)
      ? "Stopping microphone capture. The pending transcription response will be ignored."
      : transcription.inserting ? "Please wait for the insertion result."
      : transcription.state === "failed" ? transcription.transcript ? "Check your destination, then copy or retry below." : transcription.audio ? "Retry with your saved recording below." : "Check your microphone in Settings."
      : transcription.state === "inserted" && !ready ? "Finish setup in Settings before dictating again."
      : "";
    detail.hidden = detail.textContent === "";
  }
  const alert = document.querySelector<HTMLElement>("#dictation-alert")!;
  const message = clipboardIssue
    ? "Your text was sent to the destination, but the previous clipboard could not be restored. Check the destination before pasting again. Use Restore previous clipboard below, copy your text if needed, or Discard dictation to dismiss this alert."
    : transcription.inserting && transcription.stalled
      ? "The paste may already have been sent. It cannot be retracted. Waiting will end automatically; check the destination before copying or pasting again."
    : transcription.stalled
      ? transcription.cleaning
        ? "Cleanup is still waiting for OpenAI. Review and copy the original transcript below, stop waiting and keep your words, or cancel to discard this dictation. Cleanup falls back to the original after 30 seconds."
        : "Final transcription is still waiting for OpenAI. Stop waiting to keep the recording for retry, review and copy available live words, or cancel to discard this dictation. Live words may be incomplete and contain errors."
    : transcription.state === "failed"
      ? transcription.transcript
        ? transcription.error === "insertion_target_unavailable"
          ? "Your transcript is ready, but the original destination is unavailable. Copy your text below, return to the intended text field, and press Ctrl+V, or discard this dictation."
          : transcription.canRetryInsertion
            ? "Text was not pasted. Return to the original cursor and press your shortcut to retry, copy the text below for manual pasting, or discard this dictation."
            : "The paste outcome is uncertain. Check the destination before pasting again. Copy your saved text below if needed, or discard this dictation."
        : captureInterruptionMessage || transcriptionError(transcription.error ?? "transcription_audio_invalid")
      : captureInterruptionMessage ?? "";
  alert.hidden = !message;
  document.querySelector<HTMLElement>("#dictation-alert-text")!.textContent = message;
}

function showRetainedResults(locked: boolean) {
  const openSessions = new Set(Array.from(retainedResults.querySelectorAll<HTMLDetailsElement>("details[open]"))
    .map(element => element.dataset.sessionId));
  const focusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusedSession = focusedElement?.closest<HTMLDetailsElement>("details[data-session-id]")?.dataset.sessionId;
  const focusedAction = focusedElement?.dataset.action;
  retainedResults.replaceChildren();
  for (const [index, result] of transcription.retainedResults.entries()) {
    const item = document.createElement("li");
    const details = document.createElement("details");
    details.dataset.sessionId = result.sessionId;
    details.open = openSessions.has(result.sessionId);
    const label = document.createElement("summary");
    label.dataset.action = "summary";
    label.textContent = `Earlier dictation ${transcription.retainedResults.length - index}`;
    const original = document.createElement("textarea");
    original.value = result.transcript;
    original.readOnly = true;
    original.rows = 3;
    original.setAttribute("aria-label", `${label.textContent} original transcript`);
    const buttons = document.createElement("div");
    buttons.className = "row recording-actions";
    for (const [text, action] of [
      ["Copy original", () => copyRetained(result.transcript, false)],
      ["Copy output", () => copyRetained(result.outputText, false)],
      ["Discard", () => transcription.discardRetained(result.sessionId)],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.dataset.action = text;
      button.disabled = locked;
      button.addEventListener("click", action);
      buttons.append(button);
    }
    details.append(label, original, buttons);
    item.append(details);
    retainedResults.append(item);
  }
  if (focusedSession) {
    const details = Array.from(retainedResults.querySelectorAll<HTMLDetailsElement>("details[data-session-id]"))
      .find(element => element.dataset.sessionId === focusedSession);
    const control = details && Array.from(details.querySelectorAll<HTMLElement>("[data-action]"))
      .find(element => element.dataset.action === focusedAction && !(element instanceof HTMLButtonElement && element.disabled));
    (control ?? details?.querySelector<HTMLElement>("summary") ?? retainedResults.querySelector<HTMLElement>("summary"))?.focus();
  }
}

async function copyRetained(text: string, withoutBackup: boolean) {
  if (held || operationBusy || transcription.busy) return;
  operationBusy = true;
  showState();
  const resultStatus = document.querySelector<HTMLElement>("#retained-copy-status")!;
  try { resultStatus.textContent = await invoke<string>("copy_dictation_text", { text, withoutBackup }); }
  catch { resultStatus.textContent = "Copy failed. Restore the previous clipboard, or select and copy the original text above."; }
  finally { operationBusy = false; await refreshRestoreButton(); showState(); }
}

function showLiveState() {
  showOverlay();
  showProvisionalRecovery();
  liveView.value = live.text;
  liveLatency.textContent = live.firstVisibleMs === null ? "First visible text: waiting" : `First visible text: ${Math.round(live.firstVisibleMs)} ms after capture started`;
  const labels = { idle: "Live preview ready.", connecting: "Connecting live preview…", listening: "Receiving provisional words while you speak.",
    finishing: "Finishing live preview. Canonical transcription proceeds independently.", completed: "Live preview complete; this text remains provisional.",
    failed: `${live.error} Local capture and final transcription remain available.`, discarded: "Live preview cleared." };
  liveStatus.textContent = labels[live.state] + (live.hasGap ? " This preview contains a connection gap; final transcription uses the complete original audio." : "");
  liveReconnect.disabled = !recorder.isRecording || live.state !== "failed";
  showState();
}

const live = new LiveTranscription(nativeStreamingSTT, showLiveState);
actionSelect.addEventListener("change", showState);
cleanupEnabled.addEventListener("change", () => { savePreferences(); showState(); });
liveEnabled.addEventListener("change", () => { savePreferences(); showState(); });
liveReconnect.addEventListener("click", () => {
  if (recorder.isRecording) live.reconnect();
});

async function refreshRestoreButton() {
  try {
    restoreButton.disabled = !(await invoke<boolean>("has_clipboard_backup")) || held || operationBusy || transcription.busy;
  } catch {
    restoreButton.disabled = true;
  }
  setHidden("clipboard-recovery", restoreButton.disabled);
}

function displayRecording(recording: CapturedPcm) {
  if (transcription.discarded) { releaseRecording(); return; }
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = null;

  const duration = recording.durationSeconds.toFixed(2);
  const device = recording.deviceLabel || "Unknown microphone";
  const captureDetails = recording.frameCount === 0
    ? ` · diagnostics: AudioContext ${recording.audioContextState}, AudioWorklet callbacks ${recording.workletProcessCalls}, input channels ${recording.workletInputChannels}, microphone track ${recording.trackState}${recording.trackMuted ? " (muted)" : ""}`
    : "";
  recordingMetadata.textContent = `Duration: ${duration} s · sample rate: ${recording.sampleRate.toLocaleString()} Hz · channels: ${recording.channelCount} · input: ${device} · PCM retained in memory${captureDetails}`;
  clearRecordingButton.disabled = operationBusy || held;

  if (recording.frameCount > 0) {
    const wav = encodeWav(recording);
    // A microphone interruption may display the same stopped capture again.
    if (!transcription.hasResult) transcription.capture(wav);
    playbackUrl = URL.createObjectURL(wav);
    recordingPlayback.src = playbackUrl;
    recordingPlayback.hidden = false;
    recordingPlayback.load();
    inputLevelStatus.textContent = "Audio samples received. Playback is ready.";
    recordingStatus.textContent = "Recording stopped. In-memory WAV playback is ready.";
  } else {
    transcription.failRecording();
    recordingPlayback.pause();
    recordingPlayback.removeAttribute("src");
    recordingPlayback.load();
    recordingPlayback.hidden = true;
    recordingStatus.textContent = `No audio frames were captured. AudioContext ${recording.audioContextState}; AudioWorklet callbacks ${recording.workletProcessCalls}; microphone input channels ${recording.workletInputChannels}; track ${recording.trackState}${recording.trackMuted ? " (muted)" : ""}.`;
    inputLevelStatus.textContent = "No audio samples received.";
  }
  showState();
}

const recorder = new PcmRecorder(
  (recording, message) => {
    void live.finish();
    if (transcription.discarded) { releaseRecording(); return; }
    captureInterruptionMessage = message;
    displayRecording(recording);
    recordingStatus.textContent = message;
    log("microphone disconnected; partial audio retained in memory");
  },
  (message) => {
    void live.finish();
    recordingStatus.textContent = `Microphone capture stopped: ${message}`;
    log("microphone capture stopped unexpectedly");
  },
  (rms) => {
    inputLevelMeter.value = Math.min(rms, 0.5);
    inputLevelStatus.textContent = `Input level: ${(rms * 100).toFixed(1)}% RMS`;
  },
  (samples, sampleRate) => live.push(samples, sampleRate),
);

const transcription = new TranscriptionSession(
  (audio) => invoke<string>("transcribe_recording", audio),
  () => { showState(); void refreshRestoreButton(); },
  releaseRecording,
  {
    capture: async (sessionId) => {
      try { await invoke<void>("capture_dictation_target", { sessionId }); }
      finally {
        if (transcription.sessionId === sessionId && !transcription.discarded) {
          overlayCaptureReadySession = sessionId;
          showState();
        }
      }
    },
    insert: (sessionId, text) => invoke<InsertionResult>("insert_dictation_text", { sessionId, text }),
    discard: (sessionId) => invoke<void>("discard_dictation_target", { sessionId }),
  },
  { clean: (text) => invoke<string>("cleanup_transcript", { text }) },
);

function releaseRecording() {
  // Recording cancellation stops the graph asynchronously before clearing it.
  if (recorder.isRecording || recorder.isStopping) return;
  recordingPlayback.pause();
  recordingPlayback.removeAttribute("src");
  recordingPlayback.load();
  recordingPlayback.hidden = true;
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = null;
  recorder.clear();
  captureInterruptionMessage = null;
  inputLevelMeter.value = 0;
  inputLevelStatus.textContent = "Waiting for recording.";
  recordingMetadata.textContent = "No recording retained.";
  recordingStatus.textContent = "Audio released from memory.";
}

async function refreshMicrophones(reportEmptyList = true) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    recordingStatus.textContent = "Microphone device listing is unavailable in this app environment.";
    return;
  }

  const previous = preferredMicrophone || microphoneSelect.value;
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === "audioinput");
  const defaultOption = new Option("System default microphone", "");
  microphoneSelect.replaceChildren(defaultOption);

  devices.forEach((device, index) => {
    const label = device.label.trim() || `Microphone ${index + 1} (label appears after access is granted)`;
    microphoneSelect.add(new Option(label, device.deviceId));
  });

  if (previous && Array.from(microphoneSelect.options).some((option) => option.value === previous)) {
    microphoneSelect.value = previous;
  } else {
    microphoneSelect.value = "";
    if (previous) recordingStatus.textContent = "Your preferred microphone is disconnected. Using the system default until it returns.";
  }

  if (devices.length === 0 && reportEmptyList && !recorder.isRecording) {
    recordingStatus.textContent = "No microphone is listed. The system default may still work; connect an input or check Windows microphone access.";
  }
}

async function prepareMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    attemptedMicrophoneAccess = true;
    microphoneAccess = "blocked";
    microphoneIssue = "Microphone capture is unavailable in this app environment.";
    recordingStatus.textContent = microphoneIssue;
    showHomeState();
    return;
  }

  operationBusy = true;
  attemptedMicrophoneAccess = true;
  recordingStatus.textContent = "Requesting microphone access…";
  showState();

  let stream: MediaStream | null = null;
  try {
    await refreshMicrophones(false);
    const audio: MediaTrackConstraints = {
      channelCount: { ideal: 1 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (microphoneSelect.value) audio.deviceId = { exact: microphoneSelect.value };
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("The selected input did not provide an audio track.");

    const label = track.label || "System default microphone";
    const sampleRate = track.getSettings().sampleRate;
    for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
    stream = null;
    await refreshMicrophones(false);
    microphoneAccess = "ready";
    microphoneIssue = "";
    recordingStatus.textContent = `Microphone ready: ${label}${sampleRate ? ` (${sampleRate.toLocaleString()} Hz)` : ""}.`;
    log("microphone permission prepared");
  } catch (error) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    microphoneAccess = "blocked";
    recordingError(error);
  } finally {
    operationBusy = false;
    showState();
  }
}

function recordingError(error: unknown) {
  const message = microphoneErrorMessage(error);
  recordingStatus.textContent = message;
  microphoneIssue = message;
  microphoneAccess = "blocked";
  log("microphone start failed: " + message);
}

async function finishRecording(started: Promise<string> | null, autoTranscribe = true) {
  const owner = ++dictationOperation;
  const sessionId = transcription.sessionId;
  operationBusy = true;
  showState();
  try {
    await started;
    if (owner !== dictationOperation || sessionId !== transcription.sessionId) return;
    const recording = await recorder.stop();
    if (owner !== dictationOperation || sessionId !== transcription.sessionId) return;
    recordingStart = null;
    if (transcription.discarded) { releaseRecording(); return; }
    void live.finish();
    displayRecording(recording);
    if (captureInterruptionMessage) recordingStatus.textContent = captureInterruptionMessage;
    void refreshMicrophones(false).catch(() => undefined);
    // Disconnected microphones retain partial capture for an explicit retry.
    if (!captureInterruptionMessage && autoTranscribe) {
      operationBusy = false;
      await transcription.transcribe();
    }
  } catch (error) {
    if (owner !== dictationOperation || sessionId !== transcription.sessionId) return;
    if (!recorder.isRecording) void live.finish();
    if (transcription.discarded) return;
    transcription.failRecording();
    if (recordingStatus.textContent.startsWith("Microphone access was denied")
      || recordingStatus.textContent.startsWith("No microphone input is available")
      || recordingStatus.textContent.startsWith("The microphone could not be opened")
      || recordingStatus.textContent.startsWith("The selected microphone is no longer available")) {
      // The start handler already displayed the specific browser permission/device error.
    } else {
      recordingError(error);
    }
  } finally {
    if (owner === dictationOperation && sessionId === transcription.sessionId) {
      recordingStart = null;
      operationBusy = false;
      showState();
    }
  }
}

function runInsertion(pendingCapture: Promise<string> | null) {
  operationBusy = true;
  showState();
  void (async () => {
    try {
      if (!pendingCapture) throw new Error("No target capture was started.");
      await pendingCapture;
      insertionStatus.textContent = "Checking target and clipboard…";
      const result = await invoke<string>("insert_test_text");
      insertionStatus.textContent = result;
      log(result);
    } catch (error) {
      insertionStatus.textContent = String(error) + " Use Copy test text if needed.";
      log("insertion unavailable: " + String(error));
    } finally {
      operationBusy = false;
      await refreshRestoreButton();
      showState();
    }
  })();
}

function onShortcut(event: ShortcutEvent) {
  if (recordingShortcut || shortcutBusy || recoveryDialog.open) return;
  if (event.state === "Pressed") {
    if (held) return;
    if (operationBusy || transcription.busy) {
      recordingStatus.textContent = "A session is still finalizing or stopping. Wait, or cancel and discard it before recording again.";
      return;
    }
    const requestedAction = actionSelect.value === "insert" ? "insert" : actionSelect.value === "live" ? "live" : "record";
    if (requestedAction !== "insert" && transcription.canRetryInsertion) {
      held = true;
      heldAction = "retry";
      showState();
      return;
    }
    if (requestedAction !== "insert" && !transcription.canStart && !transcription.canBeginNext) {
      recordingStatus.textContent = "Recover or discard the unfinished dictation below before starting another.";
      showHomeState();
      return;
    }
    if (requestedAction !== "insert" && apiKeyState !== "saved") {
      dictationStatus.textContent = "Add your OpenAI API key in Settings before dictating.";
      setHidden("setup-callout", false);
      return;
    }
    held = true;
    heldAction = requestedAction;
    showState();
    log(event.shortcut + " key-down");

    if (heldAction === "insert") {
      insertionCapture = invoke<string>("capture_target");
      void insertionCapture.catch(() => undefined);
      insertionStatus.textContent = "Capturing the focused target…";
      return;
    }

    dictationOperation += 1;
    transcription.begin(heldAction !== "live", cleanupEnabled.checked);
    const sessionId = transcription.sessionId;
    document.querySelector<HTMLElement>("#recovery-copy-status")!.textContent = "";
    provisionalCopyStatus.textContent = "";
    captureInterruptionMessage = null;
    if (heldAction === "live") {
      overlayCaptureReadySession = transcription.sessionId;
      showState();
    }
    livePreviewSession = transcription.sessionId;
    if (liveEnabled.checked) live.begin();
    else live.cancel();

    if (recorder.hasRecording) {
      recordingStatus.textContent = "Clear the previous recording before starting another.";
      recordingStart = Promise.reject(new Error("Clear the previous recording before starting another."));
    } else {
      recordingStatus.textContent = "Requesting microphone access…";
      recordingStart = recorder.start(microphoneSelect.value)
        .then(async (message) => {
          if (transcription.discarded || transcription.sessionId !== sessionId) return message;
          microphoneAccess = "ready";
          microphoneIssue = "";
          live.captureStarted();
          recordingStatus.textContent = "Listening… " + message;
          log("microphone recording started");
          showState();
          void refreshMicrophones(false).catch(() => undefined);
          return message;
        })
        .catch((error: unknown) => {
          if (transcription.discarded || transcription.sessionId !== sessionId) throw error;
          live.cancel();
          // No captured audio or text exists yet; a startup failure does not
          // create an unresolved result the user has to discard manually.
          transcription.discard();
          recordingError(error);
          showState();
          throw error;
        });
    }
    void recordingStart.catch(() => undefined);
  } else {
    if (!held) return;
    log(event.shortcut + " key-up");
    held = false;
    const action = heldAction;
    heldAction = null;
    showState();

    if (action === "insert") {
      const pendingCapture = insertionCapture;
      insertionCapture = null;
      runInsertion(pendingCapture);
    } else if (action === "record" || action === "live") {
      recordingStatus.textContent = "Stopping recording…";
      finishRecording(recordingStart, action === "record");
    } else if (action === "retry") {
      void transcription.retryInsertion();
    }
  }
}

async function applyShortcut(shortcut: string) {
  if (held || operationBusy || transcription.busy) return;
  const next = shortcut.trim();
  if (!next) {
    status.textContent = "Choose Record shortcut, then press your keys.";
    return;
  }
  if (!/^(?:(?:Ctrl|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/.test(next)
    || !/(Ctrl|Alt|Super)\+/.test(next)) {
    status.textContent = "Use Ctrl, Alt, or Windows with another key.";
    return;
  }
  shortcutBusy = true;
  showState();

  try {
    if (!await shortcutBinding.apply(next)) return;
    held = false;
    heldAction = null;
    shortcutInput.value = next;
    status.textContent = "Shortcut saved: " + next;
    savePreferences();
    log("registered " + next);
  } catch (error) {
    shortcutInput.value = shortcutBinding.active ?? "";
    status.textContent = "That shortcut is unavailable. Try a different combination." + (shortcutBinding.available ? ` Your shortcut remains ${shortcutBinding.active}.` : " Choose Record shortcut to set an available combination.");
    log("shortcut registration unavailable");
  } finally { shortcutBusy = false; showState(); }
}

async function stopShortcutRecording(message: string) {
  recordingShortcut = false;
  shortcutBusy = true;
  shortcutInput.value = shortcutBinding.active ?? "";
  shortcutRecordButton.textContent = "Record shortcut";
  try { await shortcutBinding.resume(); status.textContent = message; }
  catch { status.textContent = "Could not restore the shortcut. Choose Record shortcut to set it again."; }
  finally { shortcutBusy = false; }
  showState();
}
shortcutRecordButton.addEventListener("click", async () => {
  if (recordingShortcut) { void stopShortcutRecording("Shortcut unchanged."); return; }
  recordingShortcut = true;
  shortcutBusy = true;
  showState();
  try { await shortcutBinding.suspend(); }
  catch {
    recordingShortcut = false;
    shortcutBusy = false;
    status.textContent = "Could not pause the current shortcut. Try again.";
    showState();
    return;
  }
  shortcutBusy = false;
  shortcutRecordButton.textContent = "Cancel recording";
  status.textContent = "Press Ctrl, Alt, or Windows with another key. Esc cancels.";
  shortcutInput.value = "Press your shortcut…";
  shortcutInput.focus();
  showState();
});
document.addEventListener("keydown", event => {
  if (recordingShortcut) {
    event.preventDefault();
    event.stopPropagation();
    if (shortcutBusy) return;
    if (event.key === "Escape") { void stopShortcutRecording("Shortcut unchanged."); return; }
    const shortcut = shortcutFromKey(event);
    if (!shortcut) {
      if (!event.repeat && !/^(Control|Alt|Shift|Meta)/.test(event.code)) status.textContent = "Use Ctrl, Alt, or Windows with another key.";
      return;
    }
    // Wait for all keys to be released before enabling the global callback.
    shortcutInput.value = shortcut;
    status.textContent = "Release your keys to save the shortcut.";
    return;
  }
  if (event.key === "Escape" && canCancelDictation()) {
    event.preventDefault();
    cancelDictation();
  }
}, true);
document.addEventListener("keyup", event => {
  if (!recordingShortcut) return;
  event.preventDefault();
  if (shortcutBusy) return;
  if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || shortcutInput.value === "Press your shortcut…") return;
  const next = shortcutInput.value;
  recordingShortcut = false;
  shortcutRecordButton.textContent = "Record shortcut";
  void applyShortcut(next);
}, true);
document.querySelector("#settings-dialog")?.addEventListener("close", () => {
  if (recordingShortcut) void stopShortcutRecording("Shortcut unchanged.");
});

document.querySelector<HTMLFormElement>("#shortcut-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void applyShortcut(shortcutInput.value);
});

document.querySelector<HTMLButtonElement>("#clear-log")!.addEventListener("click", () => {
  events.replaceChildren();
});

document.querySelector<HTMLButtonElement>("#copy-text")!.addEventListener("click", async () => {
  try {
    insertionStatus.textContent = await invoke<string>("copy_test_text");
  } catch (error) {
    insertionStatus.textContent = "Copy failed: " + String(error);
  } finally {
    await refreshRestoreButton();
  }
});

document.querySelector<HTMLButtonElement>("#copy-without-backup")!.addEventListener("click", async () => {
  try {
    insertionStatus.textContent = await invoke<string>("copy_test_text_without_backup");
  } catch (error) {
    insertionStatus.textContent = "Copy failed: " + String(error);
  } finally {
    await refreshRestoreButton();
  }
});

restoreButton.addEventListener("click", async () => {
  if (held || operationBusy || transcription.busy) return;
  operationBusy = true;
  showState();
  try {
    insertionStatus.textContent = await invoke<string>("restore_previous_clipboard");
    if (transcription.insertion?.pasteSent) transcription.insertion.clipboardRestored = true;
  } catch (error) {
    insertionStatus.textContent = "Restore failed: " + String(error);
  } finally {
    operationBusy = false;
    await refreshRestoreButton();
    showState();
  }
});

refreshDevicesButton.addEventListener("click", () => {
  void refreshMicrophones().catch((error: unknown) => {
    recordingStatus.textContent = "Could not refresh microphones: " + String(error);
  });
});

playRecordingButton.addEventListener("click", () => {
  void recordingPlayback.play()
    .then(() => {
      recordingStatus.textContent = "Playing the captured recording.";
      showState();
    })
    .catch((error: unknown) => {
      recordingStatus.textContent = "Playback failed: " + String(error);
    });
});

stopPlaybackButton.addEventListener("click", () => {
  recordingPlayback.pause();
  recordingPlayback.currentTime = 0;
  recordingStatus.textContent = "Playback stopped.";
  showState();
});

recordingPlayback.addEventListener("play", showState);
recordingPlayback.addEventListener("pause", showState);
recordingPlayback.addEventListener("ended", () => {
  recordingStatus.textContent = "Playback finished.";
  showState();
});

prepareMicrophoneButton.addEventListener("click", () => {
  void prepareMicrophone();
});

clearRecordingButton.addEventListener("click", () => {
  if (held || operationBusy || transcription.busy) return;
  try {
    transcription.discard();
    provisionalCopyStatus.textContent = "";
    live.cancel();
    log("recording cleared from memory");
    showState();
  } catch (error) {
    recordingStatus.textContent = String(error);
  }
});

transcribeButton.addEventListener("click", () => {
  if (held || operationBusy || !recordingPlayback.paused) return;
  void transcription.transcribe();
});
function cancelDictation() {
  if (transcription.inserting) return;
  const stoppingCapture = heldAction === "record" || heldAction === "live" || recorder.isRecording || recorder.isStopping;
  const started = recordingStart;
  const owner = ++dictationOperation;
  held = false;
  heldAction = null;
  if (!transcription.discard()) return;
  recorder.cancelStartup();
  provisionalCopyStatus.textContent = "";
  live.cancel();
  if (stoppingCapture) {
    // A cancelled permission prompt may never resolve. It owns no active graph
    // and its eventual stream is disposed by the recorder's generation guard.
    const needsDrain = recorder.isRecording || recorder.isStopping;
    const stopping = needsDrain ? recorder.stop() : Promise.resolve(null);
    recordingStart = null;
    operationBusy = needsDrain;
    showState();
    void (async () => {
      try { await stopping; }
      catch { /* Nothing usable remains after explicit discard. */ }
      finally {
        if (owner === dictationOperation) { releaseRecording(); recordingStart = null; operationBusy = false; showState(); }
      }
    })();
  }
  void started?.catch(() => undefined);
  showState();
}
discardButton.addEventListener("click", cancelDictation);
cancelButton.addEventListener("click", () => { if (canCancelDictation()) cancelDictation(); });

function stopProcessing() {
  if (!transcription.stopWaiting()) return false;
  dictationOperation += 1;
  recordingStart = null;
  operationBusy = false;
  showState();
  return true;
}
document.querySelector<HTMLButtonElement>("#stop-waiting")!.addEventListener("click", stopProcessing);

function confirmAvailableText(choice: RecoveryCopyChoice): Promise<boolean> {
  if (recoveryDialog.open) return Promise.resolve(false);
  const original = choice.source === "original";
  document.querySelector<HTMLElement>("#recovery-confirm-label")!.textContent = original ? "Original transcript · cleanup skipped" : "Provisional live words · final transcription skipped";
  document.querySelector<HTMLElement>("#recovery-confirm-warning")!.textContent = original
    ? "Use the original transcript without cleanup? It may have unpolished punctuation and spoken fillers. Confirming stops waiting for cleanup and copies these words."
    : "Use these provisional live words? They may be incomplete, contain gaps or recognition errors, and have not been verified against the full recording. They are not the final transcript. Confirming copies these words for manual pasting.";
  if (choice.stopWaiting && !original) document.querySelector<HTMLElement>("#recovery-confirm-warning")!.textContent += " It also stops waiting for final transcription; your recording stays available for retry.";
  document.querySelector<HTMLTextAreaElement>("#recovery-confirm-text")!.value = choice.text;
  document.querySelector<HTMLButtonElement>("#recovery-confirm-cancel")!.textContent = choice.stopWaiting ? "Keep waiting" : "Cancel";
  recoveryDialog.returnValue = "cancel";
  return new Promise(resolve => {
    recoveryDialog.addEventListener("close", () => { resolve(recoveryDialog.returnValue === "copy"); showState(); }, { once: true });
    recoveryDialog.showModal();
    showState();
    document.querySelector<HTMLButtonElement>("#recovery-confirm-cancel")!.focus();
  });
}

async function copyRecoveryChoice(choice: RecoveryCopyChoice, withoutBackup = false) {
  const resultStatus = document.querySelector<HTMLElement>("#recovery-copy-status")!;
  let accepted = false;
  try {
    const copied = await confirmRecoveryCopy(choice, {
      confirm: async snapshot => { accepted = await confirmAvailableText(snapshot); return accepted; },
      isCurrent: snapshot => snapshot.sessionId === transcription.sessionId && !transcription.discarded
        && !transcription.inserting && (!snapshot.stopWaiting || transcription.busy),
      stopWaiting: stopProcessing,
      copy: async text => {
        operationBusy = true;
        showState();
        try {
          await invoke<string>("copy_dictation_text", { text, withoutBackup });
          resultStatus.textContent = `${choice.source === "original" ? "Original transcript" : "Provisional live words"} copied. Return to your intended text field and press Ctrl+V. Review the words before pasting.`;
          provisionalCopyStatus.textContent = resultStatus.textContent;
          document.querySelector<HTMLElement>("#copy-status")!.textContent = resultStatus.textContent;
        } finally { operationBusy = false; await refreshRestoreButton(); showState(); }
      },
    });
    if (!copied && accepted) {
      const message = "Processing finished or the dictation changed while you reviewed these words. Nothing was copied. Review the current result and check your destination before copying again.";
      document.querySelector<HTMLElement>("#copy-status")!.textContent = message;
      provisionalCopyStatus.textContent = message;
    }
  } catch {
    resultStatus.textContent = "Copy failed. Your words remain available. Select and copy them, or use Clipboard options to replace the clipboard.";
    provisionalCopyStatus.textContent = resultStatus.textContent;
  }
}
bypassButton.addEventListener("click", () => {
  if (!transcription.busy || transcription.inserting || held || operationBusy) return;
  const text = transcription.transcript || provisionalRecoveryText(true);
  if (text) void copyRecoveryChoice({ sessionId: transcription.sessionId, text,
    source: transcription.transcript ? "original" : "provisional", stopWaiting: true });
});

async function copySessionText(withoutBackup: boolean, source: "output" | "original" | "provisional") {
  if (held || operationBusy || transcription.busy || transcription.inserting) return;
  const text = source === "provisional" ? provisionalRecoveryText()
    : source === "original" ? transcription.transcript : transcription.outputText;
  if (!text) return;
  if (source === "provisional") {
    await copyRecoveryChoice({ sessionId: transcription.sessionId, text, source: "provisional", stopWaiting: false }, withoutBackup);
    return;
  }
  const resultStatus = document.querySelector<HTMLElement>("#copy-status")!;
  operationBusy = true;
  showState();
  try {
    const result = await invoke<string>("copy_dictation_text", { text, withoutBackup });
    resultStatus.textContent = result + " Return to your intended text field and press Ctrl+V to paste.";
  } catch {
    resultStatus.textContent = "Copy failed. Restore the previous clipboard, or open Clipboard options and choose Replace clipboard if you want to replace its contents.";
  } finally { operationBusy = false; await refreshRestoreButton(); showState(); }
}
copyTranscriptButton.addEventListener("click", () => { void copySessionText(false, "output"); });
copyTranscriptWithoutBackupButton.addEventListener("click", () => { void copySessionText(true, "output"); });
copyOriginalButton.addEventListener("click", () => { void copySessionText(false, "original"); });
copyOriginalWithoutBackupButton.addEventListener("click", () => { void copySessionText(true, "original"); });
copyProvisionalButton.addEventListener("click", () => { void copySessionText(false, "provisional"); });
copyProvisionalWithoutBackupButton.addEventListener("click", () => { void copySessionText(true, "provisional"); });

actionSelect.addEventListener("change", () => {
  if (actionSelect.value === "insert") {
    insertionStatus.textContent = "Ready. The target will be captured on key-down.";
  } else {
    insertionStatus.textContent = "Choose “Run text insertion probe” as the hotkey action to test a target.";
  }
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  void refreshMicrophones(false).catch(() => undefined);
});

microphoneSelect.addEventListener("change", () => {
  preferredMicrophone = microphoneSelect.value;
  savePreferences();
});
document.addEventListener("api-key-state", event => {
  apiKeyState = (event as CustomEvent<{ state: string }>).detail.state;
  if (apiKeyState === "saved" && !attemptedMicrophoneAccess && !held && !operationBusy && !transcription.busy) void prepareMicrophone();
  showHomeState();
});

initializeSurface();
showState();
initializeApiKeySettings();
void refreshRestoreButton();
void refreshMicrophones().catch((error: unknown) => {
  recordingStatus.textContent = "Could not list microphones: " + String(error);
});
void applyShortcut(shortcutInput.value);
