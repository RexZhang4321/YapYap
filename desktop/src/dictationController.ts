import { flushSync } from "react-dom";
import { ui } from "./ui/store";
import {
  register,
  unregister,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import {
  encodeWav,
  microphoneErrorMessage,
  PcmRecorder,
  type CapturedPcm,
} from "./audioCapture";
import {
  TranscriptionSession,
  type InsertionResult,
} from "./transcriptionSession";
import { transcriptionError } from "./transcription";
import { LiveTranscription } from "./liveTranscription";
import { nativeStreamingSTT } from "./liveTransport";
import {
  OverlayController,
  overlayPhase,
  type OverlaySnapshot,
} from "./overlayState";
import { selectProvisionalText } from "./provisionalRecovery";
import { shortcutFromKey, ShortcutBinding, ScopedShortcut } from "./shortcuts";
import { confirmRecoveryCopy, type RecoveryCopyChoice } from "./recoveryCopy";

type HotkeyAction = "record" | "live" | "insert" | "retry";

let initialized = false;
export function initializeDictation(ports: {
  playback: () => HTMLAudioElement;
  recoveryDialog: () => HTMLDialogElement;
}) {
  if (initialized) return;
  initialized = true;
  const cleanups: (() => void)[] = [];
  const onDocument = <K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    capture = false,
  ) => {
    document.addEventListener(type, listener, capture);
    cleanups.push(() => document.removeEventListener(type, listener, capture));
  };
  const shortcutInput = ui.control("shortcut");
  const status = ui.control("status");
  const holdState = ui.control("hold-state");
  const insertionStatus = ui.control("insertion-status");
  const restoreButton = ui.control("restore-clipboard");
  const actionSelect = ui.control("hotkey-action");
  const microphoneSelect = ui.control("microphone");
  const refreshDevicesButton = ui.control("refresh-devices");
  const prepareMicrophoneButton = ui.control("prepare-microphone");
  const inputLevelMeter = ui.control("input-level");
  const inputLevelStatus = ui.control("input-level-status");
  const recordingStatus = ui.control("recording-status");
  const recordingMetadata = ui.control("recording-metadata");
  const playRecordingButton = ui.control("play-recording");
  const stopPlaybackButton = ui.control("stop-playback");
  const clearRecordingButton = ui.control("clear-recording");
  const transcribeButton = ui.control("transcribe-recording");
  const discardButton = ui.control("discard-transcription");
  const transcriptionStatus = ui.control("transcription-status");
  const transcriptView = ui.control("transcript");
  const sessionState = ui.control("session-state");
  const copyTranscriptButton = ui.control("copy-transcript");
  const copyTranscriptWithoutBackupButton = ui.control(
    "copy-transcript-without-backup",
  );
  const copyOriginalButton = ui.control("copy-original");
  const copyOriginalWithoutBackupButton = ui.control(
    "copy-original-without-backup",
  );
  const cleanupEnabled = ui.control("cleanup-enabled");
  const cleanedTranscriptView = ui.control("cleaned-transcript");
  const cleanupStatus = ui.control("cleanup-status");
  const applyShortcutButton = ui.control("apply-shortcut");
  const liveEnabled = ui.control("live-enabled");
  const liveView = ui.control("live-transcript");
  const liveStatus = ui.control("live-status");
  const liveLatency = ui.control("live-latency");
  const liveReconnect = ui.control("live-reconnect");
  const copyProvisionalButton = ui.control("copy-provisional");
  const copyProvisionalWithoutBackupButton = ui.control(
    "copy-provisional-without-backup",
  );
  const provisionalCopyStatus = ui.control("provisional-copy-status");
  const overlayStatus = ui.control("overlay-status");

  const shortcutRecordButton = ui.control("shortcut-record");
  const cancelButton = ui.control("cancel-dictation");
  const dictationStatus = ui.control("dictation-status");
  const bypassButton = ui.control("bypass-processing");
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
      const value: unknown = JSON.parse(
        localStorage.getItem(preferencesKey) ?? "{}",
      );
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  function savePreferences() {
    try {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          shortcut: shortcutBinding.active,
          microphone: preferredMicrophone,
          cleanup: cleanupEnabled.checked,
          live: liveEnabled.checked,
        }),
      );
    } catch {
      status.text =
        "Settings work for this session. Windows could not save them for next time.";
    }
  }
  const preferences = savedPreferences();
  let preferredMicrophone =
    typeof preferences.microphone === "string" ? preferences.microphone : "";
  if (typeof preferences.shortcut === "string")
    shortcutInput.value = preferences.shortcut;
  if (typeof preferences.cleanup === "boolean")
    cleanupEnabled.checked = preferences.cleanup;
  if (typeof preferences.live === "boolean")
    liveEnabled.checked = preferences.live;

  const shortcutBinding = new ShortcutBinding(
    (next) =>
      register(next, (event) => {
        if (shortcutBinding.available && shortcutBinding.active === next)
          onShortcut(event);
      }),
    unregister,
  );
  const escapeBinding = new ScopedShortcut(
    () =>
      register("Escape", (event) => {
        if (event.state === "Pressed" && canCancelDictation())
          cancelDictation();
      }),
    () => unregister("Escape"),
    (available) => {
      escapeAvailable = available;
      showHomeState();
    },
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
    (snapshot) => invoke<void>("update_overlay", { snapshot }),
    (failed) => {
      overlayStatus.text = failed
        ? "The floating status window is unavailable. Recording and recovery remain available here."
        : "The floating window shows live words and status. Open Dictation from the tray to recover text.";
    },
  );

  function log(message: string) {
    const line = new Date().toISOString() + "  " + message;
    ui.addLog(line);
    console.info(line);
  }

  function showOverlay() {
    overlay.update(
      transcription.sessionId !== overlayCaptureReadySession
        ? "hidden"
        : overlayPhase({
            state: transcription.state,
            busy: transcription.busy,
            inserting: transcription.inserting,
            error: transcription.stalled
              ? "request_stalled"
              : transcription.error,
            insertion: transcription.insertion,
            interrupted:
              captureInterruptionMessage !== null && !transcription.transcript,
            stopping: operationBusy && recordingStart !== null,
          }),
      livePreviewSession === transcription.sessionId && liveEnabled.checked
        ? live
        : undefined,
    );
  }

  function provisionalRecoveryText(allowProcessing = false): string | null {
    return selectProvisionalText({
      sessionId: transcription.sessionId,
      previewSessionId: livePreviewSession,
      sessionState: transcription.state,
      discarded: transcription.discarded,
      held,
      operationBusy,
      busy: transcription.busy,
      inserting: transcription.inserting,
      liveState: live.state,
      text: live.text,
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
    holdState.text = held ? "DOWN" : "UP";
    const locked = held || operationBusy || transcription.busy;
    ui.setActive(locked);
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
    playRecordingButton.disabled =
      locked || !recorder.hasPlayableRecording || !ports.playback().paused;
    stopPlaybackButton.disabled = locked || ports.playback().paused;
    clearRecordingButton.disabled = locked || !recorder.hasRecording;
    transcribeButton.disabled =
      locked || !transcription.audio || !ports.playback().paused;
    transcribeButton.text = "Retry transcription";
    discardButton.disabled =
      transcription.inserting ||
      transcription.state === "idle" ||
      transcription.state === "discarded";
    if (operationBusy && !recordingStart) discardButton.disabled = true;
    discardButton.hidden =
      held || transcription.busy || transcription.state === "recording";
    discardButton.text = "Discard this dictation";
    cancelButton.disabled = !cancellable;
    cancelButton.hidden = !cancellable;
    cancelButton.text =
      (transcription.busy ||
      transcription.state === "recording" ||
      recordingStart !== null
        ? "Cancel dictation"
        : "Discard dictation") + (escapeAvailable ? " · Esc" : "");
    const processingRecovery =
      transcription.busy && !transcription.inserting && !held && !operationBusy;
    setHidden("processing-recovery", !processingRecovery);
    const recoverable =
      transcription.transcript || provisionalRecoveryText(true);
    bypassButton.hidden = !processingRecovery || !recoverable;
    bypassButton.text = transcription.transcript
      ? "Skip cleanup · review original…"
      : "Use live words · review…";
    ui.control("processing-recovery-hint").text = transcription.transcript
      ? "You can stop cleanup and copy your original transcript for manual pasting."
      : "Final transcription uses your full recording for accuracy. You can stop waiting and review the provisional live words, or keep the recording for retry.";
    copyTranscriptButton.disabled = locked || !transcription.transcript;
    copyTranscriptWithoutBackupButton.disabled =
      locked || !transcription.transcript;
    copyOriginalButton.disabled = locked || !transcription.transcript;
    copyOriginalWithoutBackupButton.disabled =
      locked || !transcription.transcript;
    const copyLabel =
      transcription.cleanedTranscript !== null
        ? "Copy cleaned"
        : "Copy transcript";
    copyTranscriptButton.text = copyLabel;
    copyTranscriptWithoutBackupButton.text = "Replace clipboard with text";
    sessionState.text = transcription.state;
    ui.control("copy-text").disabled = locked;
    ui.control("copy-without-backup").disabled = locked;
    transcriptView.value = transcription.transcript;
    cleanedTranscriptView.value = transcription.cleanedTranscript ?? "";
    cleanupStatus.text = transcription.cleanupWarning
      ? "Cleanup was unavailable. Your original words are used instead."
      : transcription.cleaning && !transcription.discarded
        ? "Tidying your words…"
        : transcription.cleanedTranscript !== null
          ? "Tidied text ready. Your original words are also available."
          : transcription.state !== "idle" &&
              transcription.state !== "discarded"
            ? transcription.usesCleanup
              ? "Light cleanup is on."
              : "Using your original words."
            : cleanupEnabled.checked
              ? "Light cleanup is on for your next dictation."
              : "Your next dictation will use your original words.";
    if (transcription.discarded) {
      transcriptionStatus.text = transcription.busy
        ? "Cancelled. The pending response will be ignored."
        : "Dictation discarded.";
    } else if (transcription.inserting) {
      transcriptionStatus.text = "Inserting text. Please wait for the result.";
    } else if (transcription.busy) {
      transcriptionStatus.text = transcription.state === "failed" && transcription.transcript
        ? "Capturing your chosen paste destination…"
        : transcription.cleaning
        ? "Tidying your words…"
        : "Transcribing…";
    } else if (transcription.state === "recording") {
      transcriptionStatus.text =
        actionSelect.value === "live"
          ? "Listening. Release to save this test recording."
          : "Listening. Release to finish, or Esc to cancel.";
    } else if (transcription.insertion) {
      transcriptionStatus.text =
        (transcription.state === "inserted" ? "Completed. " : "") +
        transcription.insertion.message +
        (transcription.canRetryInsertion
          ? " Focus your intended text field, then press and release your shortcut to paste the saved text there. You can also copy the text."
          : " Your original words remain here until you discard them or quit.");
    } else if (transcription.transcript && transcription.error) {
      transcriptionStatus.text =
        transcription.canRetryInsertion
          ? "The destination could not be captured. Focus your intended text field, then press and release your shortcut to paste the saved text there, or use Copy."
          : "Check the destination before pasting again. Your text is safe here; use Copy if needed.";
    } else if (transcription.error) {
      transcriptionStatus.text =
        transcriptionError(transcription.error) +
        " Retry uses your saved recording." +
        (provisionalRecoveryText() !== null
          ? " Live words are also available below."
          : "");
    } else if (transcription.transcript) {
      transcriptionStatus.text =
        "Text ready. Your original words stay here until you discard them or quit.";
    } else {
      transcriptionStatus.text = transcription.audio
        ? "Recording saved. Choose Retry transcription to try again."
        : actionSelect.value === "live"
          ? "Hold your shortcut to preview live words."
          : "Hold your shortcut in any text field. Release to insert.";
    }
    showHomeState();
    showRetainedResults(locked);
  }

  function canCancelDictation() {
    return (
      !transcription.discarded &&
      !transcription.inserting &&
      !ports.recoveryDialog().open &&
      (transcription.state === "recording" ||
        transcription.busy ||
        recordingStart !== null ||
        transcription.state === "failed" ||
        transcription.hasResult)
    );
  }

  function setHidden(id: Parameters<typeof ui.control>[0], hidden: boolean) {
    ui.control(id).hidden = hidden;
  }

  function showHomeState() {
    const active = held || operationBusy || transcription.busy;
    const ready =
      apiKeyState === "saved" &&
      microphoneAccess === "ready" &&
      shortcutBinding.available;
    const home = ui.control("home-panel");
    const clipboardIssue =
      transcription.insertion?.pasteSent &&
      !transcription.insertion.clipboardRestored;
    const needsAttention =
      transcription.state === "failed" ||
      transcription.stalled ||
      clipboardIssue;
    if (home)
      home.state = needsAttention
        ? "error"
        : held
          ? "recording"
          : active
            ? "active"
            : ready
              ? "ready"
              : "setup";
    const display = ui.control("shortcut-display");
    if (display) display.text = shortcutBinding.active ?? "Set a shortcut";
    const setupMessage = ui.control("setup-message");
    if (setupMessage)
      setupMessage.text =
        apiKeyState !== "saved"
          ? "Add your OpenAI API key in Settings to start dictating."
          : microphoneAccess === "blocked"
            ? microphoneIssue ||
              "Allow microphone access in Windows settings, then retry in Settings."
            : microphoneAccess === "unknown"
              ? "Checking microphone access…"
              : "Choose an available dictation shortcut in Settings.";
    const accessHelp = ui.control("microphone-access-help");
    if (accessHelp)
      accessHelp.text =
        microphoneAccess === "ready"
          ? "Microphone ready. It opens only while you dictate."
          : microphoneAccess === "blocked"
            ? microphoneIssue || "Allow microphone access, then retry."
            : "Microphone access is checked automatically after your key is saved. Allow access once when asked.";
    setHidden("setup-callout", ready || active);
    setHidden(
      "live-panel",
      !(
        (active && liveEnabled.checked && live.text !== "") ||
        (transcription.state === "failed" && provisionalRecoveryText() !== null)
      ),
    );
    setHidden(
      "recovery-panel",
      held ||
        (operationBusy && !transcription.hasResult) ||
        (!transcription.hasResult && transcription.state !== "failed"),
    );
    liveReconnect.hidden = liveReconnect.disabled;
    const cancelHint = ui.control("cancel-hint");
    if (cancelHint) {
      cancelHint.hidden = !canCancelDictation() && (!ready || active);
      cancelHint.text = canCancelDictation()
        ? escapeAvailable
          ? "Press Esc to cancel."
          : "Global Esc is unavailable. Use Cancel here."
        : "Press Esc while dictating to cancel.";
    }
    setHidden("audio-recovery", !transcription.audio);
    setHidden("current-result", !transcription.transcript);
    setHidden(
      "cleaned-transcript-panel",
      transcription.cleanedTranscript === null,
    );
    const originalPanel = ui.control("original-transcript-panel");
    if (originalPanel && transcription.cleanedTranscript === null)
      originalPanel.open = true;
    setHidden(
      "provisional-recovery",
      transcription.state !== "failed" || provisionalRecoveryText() === null,
    );
    setHidden("retained-panel", transcription.retainedResults.length === 0);
    setHidden("clipboard-recovery", restoreButton.disabled);
    dictationStatus.text = transcription.inserting
      ? "Inserting text…"
      : transcription.discarded && (operationBusy || transcription.busy)
        ? "Cancelled"
          : transcription.busy
          ? transcription.state === "failed" && transcription.transcript
            ? "Preparing to paste saved text…"
            : transcription.stalled
            ? transcription.cleaning
              ? "Cleanup is taking longer than expected"
              : "Transcription is taking longer than expected"
            : transcription.cleaning
              ? "Tidying your words…"
              : "Transcribing…"
          : held
            ? heldAction === "retry"
              ? "Release to paste saved text"
              : recorder.isRecording
              ? "Listening"
              : "Opening microphone…"
            : operationBusy
              ? microphoneAccess === "unknown"
                ? "Checking microphone access…"
                : "Finishing…"
              : clipboardIssue
                ? "Text inserted · clipboard needs attention"
                : transcription.state === "failed"
                  ? "Dictation needs attention"
                  : transcription.state === "inserted"
                    ? "Inserted"
                    : transcription.audio
                      ? "Recording ready"
                      : ready
                        ? "Ready to dictate"
                        : "Setup needed";
    const detail = ui.control("dictation-detail");
    if (detail) {
      detail.text =
        transcription.discarded && (operationBusy || transcription.busy)
          ? "Stopping microphone capture. The pending transcription response will be ignored."
          : transcription.inserting
            ? "Please wait for the insertion result."
            : transcription.state === "failed"
              ? transcription.transcript
                ? "Check your destination, then copy or retry below."
                : transcription.audio
                  ? "Retry with your saved recording below."
                  : "Check your microphone in Settings."
              : transcription.state === "inserted" && !ready
                ? "Finish setup in Settings before dictating again."
                : "";
      detail.hidden = detail.text === "";
    }
    const alert = ui.control("dictation-alert");
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
                ? "Your transcript is ready, but the destination could not be captured. Focus your intended text field, then press and release your shortcut to paste the saved text there. You can also copy your text below or discard this dictation."
                : transcription.canRetryInsertion
                  ? `Text was not pasted. ${transcription.insertion?.message ?? ""} Focus your intended text field, then press and release your shortcut to paste the saved text there. You can also copy your text below or discard this dictation.`
                  : "The paste outcome is uncertain. Check the destination before pasting again. Copy your saved text below if needed, or discard this dictation."
              : captureInterruptionMessage ||
                transcriptionError(
                  transcription.error ?? "transcription_audio_invalid",
                )
            : (captureInterruptionMessage ?? "");
    alert.hidden = !message;
    ui.control("dictation-alert-text").text = message;
  }

  function showRetainedResults(locked: boolean) {
    ui.setRetained(transcription.retainedResults, locked);
  }

  ui.onRetained((action, sessionId) => {
    const result = transcription.retainedResults.find(
      (result) => result.sessionId === sessionId,
    );
    if (!result || held || operationBusy || transcription.busy) return;
    if (action === "discard") transcription.discardRetained(sessionId);
    else
      void copyRetained(
        action === "original" ? result.transcript : result.outputText,
        false,
      );
  });

  async function copyRetained(text: string, withoutBackup: boolean) {
    if (held || operationBusy || transcription.busy) return;
    operationBusy = true;
    showState();
    const resultStatus = ui.control("retained-copy-status");
    try {
      resultStatus.text = await invoke<string>("copy_dictation_text", {
        text,
        withoutBackup,
      });
    } catch {
      resultStatus.text =
        "Copy failed. Restore the previous clipboard, or select and copy the original text above.";
    } finally {
      operationBusy = false;
      await refreshRestoreButton();
      showState();
    }
  }

  function showLiveState() {
    showOverlay();
    showProvisionalRecovery();
    liveView.value = live.text;
    liveLatency.text =
      live.firstVisibleMs === null
        ? "First visible text: waiting"
        : `First visible text: ${Math.round(live.firstVisibleMs)} ms after capture started`;
    const labels = {
      idle: "Live preview ready.",
      connecting: "Connecting live preview…",
      listening: "Receiving provisional words while you speak.",
      finishing:
        "Finishing live preview. Canonical transcription proceeds independently.",
      completed: "Live preview complete; this text remains provisional.",
      failed: `${live.error} Local capture and final transcription remain available.`,
      discarded: "Live preview cleared.",
    };
    liveStatus.text =
      labels[live.state] +
      (live.hasGap
        ? " This preview contains a connection gap; final transcription uses the complete original audio."
        : "");
    liveReconnect.disabled = !recorder.isRecording || live.state !== "failed";
    showState();
  }

  const live = new LiveTranscription(nativeStreamingSTT, showLiveState);
  ui.on("hotkey-action", "change", showState);
  ui.on("cleanup-enabled", "change", () => {
    savePreferences();
    showState();
  });
  ui.on("live-enabled", "change", () => {
    savePreferences();
    showState();
  });
  ui.on("live-reconnect", "click", () => {
    if (recorder.isRecording) live.reconnect();
  });

  async function refreshRestoreButton() {
    try {
      restoreButton.disabled =
        !(await invoke<boolean>("has_clipboard_backup")) ||
        held ||
        operationBusy ||
        transcription.busy;
    } catch {
      restoreButton.disabled = true;
    }
    setHidden("clipboard-recovery", restoreButton.disabled);
  }

  function displayRecording(recording: CapturedPcm) {
    if (transcription.discarded) {
      releaseRecording();
      return;
    }
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;

    const duration = recording.durationSeconds.toFixed(2);
    const device = recording.deviceLabel || "Unknown microphone";
    const captureDetails =
      recording.frameCount === 0
        ? ` · diagnostics: AudioContext ${recording.audioContextState}, AudioWorklet callbacks ${recording.workletProcessCalls}, input channels ${recording.workletInputChannels}, microphone track ${recording.trackState}${recording.trackMuted ? " (muted)" : ""}`
        : "";
    recordingMetadata.text = `Duration: ${duration} s · sample rate: ${recording.sampleRate.toLocaleString()} Hz · channels: ${recording.channelCount} · input: ${device} · PCM retained in memory${captureDetails}`;
    clearRecordingButton.disabled = operationBusy || held;

    if (recording.frameCount > 0) {
      const wav = encodeWav(recording);
      // A microphone interruption may display the same stopped capture again.
      if (!transcription.hasResult) transcription.capture(wav);
      playbackUrl = URL.createObjectURL(wav);
      ports.playback().src = playbackUrl;
      ui.control("recording-playback").hidden = false;
      ports.playback().load();
      inputLevelStatus.text = "Audio samples received. Playback is ready.";
      recordingStatus.text =
        "Recording stopped. In-memory WAV playback is ready.";
    } else {
      transcription.failRecording();
      ports.playback().pause();
      ports.playback().removeAttribute("src");
      ports.playback().load();
      ui.control("recording-playback").hidden = true;
      recordingStatus.text = `No audio frames were captured. AudioContext ${recording.audioContextState}; AudioWorklet callbacks ${recording.workletProcessCalls}; microphone input channels ${recording.workletInputChannels}; track ${recording.trackState}${recording.trackMuted ? " (muted)" : ""}.`;
      inputLevelStatus.text = "No audio samples received.";
    }
    showState();
  }

  const recorder = new PcmRecorder(
    (recording, message) => {
      void live.finish();
      if (transcription.discarded) {
        releaseRecording();
        return;
      }
      captureInterruptionMessage = message;
      displayRecording(recording);
      recordingStatus.text = message;
      log("microphone disconnected; partial audio retained in memory");
    },
    (message) => {
      void live.finish();
      recordingStatus.text = `Microphone capture stopped: ${message}`;
      log("microphone capture stopped unexpectedly");
    },
    (rms) => {
      inputLevelMeter.value = String(Math.min(rms, 0.5));
      inputLevelStatus.text = `Input level: ${(rms * 100).toFixed(1)}% RMS`;
    },
    (samples, sampleRate) => live.push(samples, sampleRate),
  );

  const transcription = new TranscriptionSession(
    (audio) => invoke<string>("transcribe_recording", audio),
    () => {
      showState();
      void refreshRestoreButton();
    },
    releaseRecording,
    {
      capture: async (sessionId) => {
        try {
          await invoke<void>("capture_dictation_target", { sessionId });
        } finally {
          if (
            transcription.sessionId === sessionId &&
            !transcription.discarded
          ) {
            overlayCaptureReadySession = sessionId;
            showState();
          }
        }
      },
      insert: (sessionId, text) =>
        invoke<InsertionResult>("insert_dictation_text", { sessionId, text }),
      discard: (sessionId) =>
        invoke<void>("discard_dictation_target", { sessionId }),
    },
    { clean: (text) => invoke<string>("cleanup_transcript", { text }) },
  );

  function releaseRecording() {
    // Recording cancellation stops the graph asynchronously before clearing it.
    if (recorder.isRecording || recorder.isStopping) return;
    ports.playback().pause();
    ports.playback().removeAttribute("src");
    ports.playback().load();
    ui.control("recording-playback").hidden = true;
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
    recorder.clear();
    captureInterruptionMessage = null;
    inputLevelMeter.value = "0";
    inputLevelStatus.text = "Waiting for recording.";
    recordingMetadata.text = "No recording retained.";
    recordingStatus.text = "Audio released from memory.";
  }

  async function refreshMicrophones(reportEmptyList = true) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      recordingStatus.text =
        "Microphone device listing is unavailable in this app environment.";
      return;
    }

    const previous = preferredMicrophone || microphoneSelect.value;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    microphoneSelect.options = [
      { label: "System default microphone", value: "" },
      ...devices.map((device, index) => ({
        value: device.deviceId,
        label:
          device.label.trim() ||
          `Microphone ${index + 1} (label appears after access is granted)`,
      })),
    ];

    if (
      previous &&
      Array.from(microphoneSelect.options).some(
        (option) => option.value === previous,
      )
    ) {
      microphoneSelect.value = previous;
    } else {
      microphoneSelect.value = "";
      if (previous)
        recordingStatus.text =
          "Your preferred microphone is disconnected. Using the system default until it returns.";
    }

    if (devices.length === 0 && reportEmptyList && !recorder.isRecording) {
      recordingStatus.text =
        "No microphone is listed. The system default may still work; connect an input or check Windows microphone access.";
    }
  }

  async function prepareMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      attemptedMicrophoneAccess = true;
      microphoneAccess = "blocked";
      microphoneIssue =
        "Microphone capture is unavailable in this app environment.";
      recordingStatus.text = microphoneIssue;
      showHomeState();
      return;
    }

    operationBusy = true;
    attemptedMicrophoneAccess = true;
    recordingStatus.text = "Requesting microphone access…";
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
      if (microphoneSelect.value)
        audio.deviceId = { exact: microphoneSelect.value };
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      const track = stream.getAudioTracks()[0];
      if (!track)
        throw new Error("The selected input did not provide an audio track.");

      const label = track.label || "System default microphone";
      const sampleRate = track.getSettings().sampleRate;
      for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
      stream = null;
      await refreshMicrophones(false);
      microphoneAccess = "ready";
      microphoneIssue = "";
      recordingStatus.text = `Microphone ready: ${label}${sampleRate ? ` (${sampleRate.toLocaleString()} Hz)` : ""}.`;
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
    recordingStatus.text = message;
    microphoneIssue = message;
    microphoneAccess = "blocked";
    log("microphone start failed: " + message);
  }

  async function finishRecording(
    started: Promise<string> | null,
    autoTranscribe = true,
  ) {
    const owner = ++dictationOperation;
    const sessionId = transcription.sessionId;
    operationBusy = true;
    showState();
    try {
      await started;
      if (owner !== dictationOperation || sessionId !== transcription.sessionId)
        return;
      const recording = await recorder.stop();
      if (owner !== dictationOperation || sessionId !== transcription.sessionId)
        return;
      recordingStart = null;
      if (transcription.discarded) {
        releaseRecording();
        return;
      }
      void live.finish();
      displayRecording(recording);
      if (captureInterruptionMessage)
        recordingStatus.text = captureInterruptionMessage;
      void refreshMicrophones(false).catch(() => undefined);
      // Disconnected microphones retain partial capture for an explicit retry.
      if (!captureInterruptionMessage && autoTranscribe) {
        operationBusy = false;
        await transcription.transcribe();
      }
    } catch (error) {
      if (owner !== dictationOperation || sessionId !== transcription.sessionId)
        return;
      if (!recorder.isRecording) void live.finish();
      if (transcription.discarded) return;
      transcription.failRecording();
      if (
        recordingStatus.text.startsWith("Microphone access was denied") ||
        recordingStatus.text.startsWith("No microphone input is available") ||
        recordingStatus.text.startsWith("The microphone could not be opened") ||
        recordingStatus.text.startsWith(
          "The selected microphone is no longer available",
        )
      ) {
        // The start handler already displayed the specific browser permission/device error.
      } else {
        recordingError(error);
      }
    } finally {
      if (
        owner === dictationOperation &&
        sessionId === transcription.sessionId
      ) {
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
        insertionStatus.text = "Checking target and clipboard…";
        const result = await invoke<string>("insert_test_text");
        insertionStatus.text = result;
        log(result);
      } catch (error) {
        insertionStatus.text = String(error) + " Use Copy test text if needed.";
        log("insertion unavailable: " + String(error));
      } finally {
        operationBusy = false;
        await refreshRestoreButton();
        showState();
      }
    })();
  }

  function onShortcut(event: ShortcutEvent) {
    if (recordingShortcut || shortcutBusy || ports.recoveryDialog().open)
      return;
    if (event.state === "Pressed") {
      if (held) return;
      if (operationBusy || transcription.busy) {
        recordingStatus.text =
          "A session is still finalizing or stopping. Wait, or cancel and discard it before recording again.";
        return;
      }
      const requestedAction =
        actionSelect.value === "insert"
          ? "insert"
          : actionSelect.value === "live"
            ? "live"
            : "record";
      if (requestedAction !== "insert" && transcription.canRetryInsertion) {
        held = true;
        heldAction = "retry";
        showState();
        return;
      }
      if (
        requestedAction !== "insert" &&
        !transcription.canStart &&
        !transcription.canBeginNext
      ) {
        recordingStatus.text =
          "Recover or discard the unfinished dictation below before starting another.";
        showHomeState();
        return;
      }
      if (requestedAction !== "insert" && apiKeyState !== "saved") {
        dictationStatus.text =
          "Add your OpenAI API key in Settings before dictating.";
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
        insertionStatus.text = "Capturing the focused target…";
        return;
      }

      dictationOperation += 1;
      transcription.begin(heldAction !== "live", cleanupEnabled.checked);
      const sessionId = transcription.sessionId;
      ui.control("recovery-copy-status").text = "";
      provisionalCopyStatus.text = "";
      captureInterruptionMessage = null;
      if (heldAction === "live") {
        overlayCaptureReadySession = transcription.sessionId;
        showState();
      }
      livePreviewSession = transcription.sessionId;
      if (liveEnabled.checked) live.begin();
      else live.cancel();

      if (recorder.hasRecording) {
        recordingStatus.text =
          "Clear the previous recording before starting another.";
        recordingStart = Promise.reject(
          new Error("Clear the previous recording before starting another."),
        );
      } else {
        recordingStatus.text = "Requesting microphone access…";
        recordingStart = recorder
          .start(microphoneSelect.value)
          .then(async (message) => {
            if (
              transcription.discarded ||
              transcription.sessionId !== sessionId
            )
              return message;
            microphoneAccess = "ready";
            microphoneIssue = "";
            live.captureStarted();
            recordingStatus.text = "Listening… " + message;
            log("microphone recording started");
            showState();
            void refreshMicrophones(false).catch(() => undefined);
            return message;
          })
          .catch((error: unknown) => {
            if (
              transcription.discarded ||
              transcription.sessionId !== sessionId
            )
              throw error;
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
        recordingStatus.text = "Stopping recording…";
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
      status.text = "Choose Record shortcut, then press your keys.";
      return;
    }
    if (
      !/^(?:(?:Ctrl|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/.test(
        next,
      ) ||
      !/(Ctrl|Alt|Super)\+/.test(next)
    ) {
      status.text = "Use Ctrl, Alt, or Windows with another key.";
      return;
    }
    shortcutBusy = true;
    showState();

    try {
      if (!(await shortcutBinding.apply(next))) return;
      held = false;
      heldAction = null;
      shortcutInput.value = next;
      status.text = "Shortcut saved: " + next;
      savePreferences();
      log("registered " + next);
    } catch (error) {
      shortcutInput.value = shortcutBinding.active ?? "";
      status.text =
        "That shortcut is unavailable. Try a different combination." +
        (shortcutBinding.available
          ? ` Your shortcut remains ${shortcutBinding.active}.`
          : " Choose Record shortcut to set an available combination.");
      log("shortcut registration unavailable");
    } finally {
      shortcutBusy = false;
      showState();
    }
  }

  async function stopShortcutRecording(message: string) {
    recordingShortcut = false;
    shortcutBusy = true;
    shortcutInput.value = shortcutBinding.active ?? "";
    shortcutRecordButton.text = "Record shortcut";
    try {
      await shortcutBinding.resume();
      status.text = message;
    } catch {
      status.text =
        "Could not restore the shortcut. Choose Record shortcut to set it again.";
    } finally {
      shortcutBusy = false;
    }
    showState();
  }
  ui.on("shortcut-record", "click", async () => {
    if (recordingShortcut) {
      void stopShortcutRecording("Shortcut unchanged.");
      return;
    }
    recordingShortcut = true;
    shortcutBusy = true;
    showState();
    try {
      await shortcutBinding.suspend();
    } catch {
      recordingShortcut = false;
      shortcutBusy = false;
      status.text = "Could not pause the current shortcut. Try again.";
      showState();
      return;
    }
    shortcutBusy = false;
    shortcutRecordButton.text = "Cancel recording";
    status.text = "Press Ctrl, Alt, or Windows with another key. Esc cancels.";
    shortcutInput.value = "Press your shortcut…";
    ui.focus("shortcut");
    showState();
  });
  onDocument(
    "keydown",
    (event) => {
      if (recordingShortcut) {
        event.preventDefault();
        event.stopPropagation();
        if (shortcutBusy) return;
        if (event.key === "Escape") {
          void stopShortcutRecording("Shortcut unchanged.");
          return;
        }
        const shortcut = shortcutFromKey(event);
        if (!shortcut) {
          if (!event.repeat && !/^(Control|Alt|Shift|Meta)/.test(event.code))
            status.text = "Use Ctrl, Alt, or Windows with another key.";
          return;
        }
        // Wait for all keys to be released before enabling the global callback.
        shortcutInput.value = shortcut;
        status.text = "Release your keys to save the shortcut.";
        return;
      }
      if (event.key === "Escape" && canCancelDictation()) {
        event.preventDefault();
        cancelDictation();
      }
    },
    true,
  );
  onDocument(
    "keyup",
    (event) => {
      if (!recordingShortcut) return;
      event.preventDefault();
      if (shortcutBusy) return;
      if (
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey ||
        shortcutInput.value === "Press your shortcut…"
      )
        return;
      const next = shortcutInput.value;
      recordingShortcut = false;
      shortcutRecordButton.text = "Record shortcut";
      void applyShortcut(next);
    },
    true,
  );
  ui.on("settings-dialog", "close", () => {
    if (recordingShortcut) void stopShortcutRecording("Shortcut unchanged.");
  });

  ui.on("shortcut-form", "submit", (event) => {
    event.preventDefault();
    void applyShortcut(shortcutInput.value);
  });

  ui.on("clear-log", "click", () => {
    ui.clearLog();
  });

  ui.on("copy-text", "click", async () => {
    try {
      insertionStatus.text = await invoke<string>("copy_test_text");
    } catch (error) {
      insertionStatus.text = "Copy failed: " + String(error);
    } finally {
      await refreshRestoreButton();
    }
  });

  ui.on("copy-without-backup", "click", async () => {
    try {
      insertionStatus.text = await invoke<string>(
        "copy_test_text_without_backup",
      );
    } catch (error) {
      insertionStatus.text = "Copy failed: " + String(error);
    } finally {
      await refreshRestoreButton();
    }
  });

  ui.on("restore-clipboard", "click", async () => {
    if (held || operationBusy || transcription.busy) return;
    operationBusy = true;
    showState();
    try {
      insertionStatus.text = await invoke<string>("restore_previous_clipboard");
      if (transcription.insertion?.pasteSent)
        transcription.insertion.clipboardRestored = true;
    } catch (error) {
      insertionStatus.text = "Restore failed: " + String(error);
    } finally {
      operationBusy = false;
      await refreshRestoreButton();
      showState();
    }
  });

  ui.on("refresh-devices", "click", () => {
    void refreshMicrophones().catch((error: unknown) => {
      recordingStatus.text = "Could not refresh microphones: " + String(error);
    });
  });

  ui.on("play-recording", "click", () => {
    void ports.playback()
      .play()
      .then(() => {
        recordingStatus.text = "Playing the captured recording.";
        showState();
      })
      .catch((error: unknown) => {
        recordingStatus.text = "Playback failed: " + String(error);
      });
  });

  ui.on("stop-playback", "click", () => {
    ports.playback().pause();
    ports.playback().currentTime = 0;
    recordingStatus.text = "Playback stopped.";
    showState();
  });

  ui.on("recording-playback", "play", showState);
  ui.on("recording-playback", "pause", showState);
  ui.on("recording-playback", "ended", () => {
    recordingStatus.text = "Playback finished.";
    showState();
  });

  ui.on("prepare-microphone", "click", () => {
    void prepareMicrophone();
  });

  ui.on("clear-recording", "click", () => {
    if (held || operationBusy || transcription.busy) return;
    try {
      transcription.discard();
      provisionalCopyStatus.text = "";
      live.cancel();
      log("recording cleared from memory");
      showState();
    } catch (error) {
      recordingStatus.text = String(error);
    }
  });

  ui.on("transcribe-recording", "click", () => {
    if (held || operationBusy || !ports.playback().paused) return;
    void transcription.transcribe();
  });
  function cancelDictation() {
    if (transcription.inserting) return;
    const stoppingCapture =
      heldAction === "record" ||
      heldAction === "live" ||
      recorder.isRecording ||
      recorder.isStopping;
    const started = recordingStart;
    const owner = ++dictationOperation;
    held = false;
    heldAction = null;
    if (!transcription.discard()) return;
    recorder.cancelStartup();
    provisionalCopyStatus.text = "";
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
        try {
          await stopping;
        } catch {
          /* Nothing usable remains after explicit discard. */
        } finally {
          if (owner === dictationOperation) {
            releaseRecording();
            recordingStart = null;
            operationBusy = false;
            showState();
          }
        }
      })();
    }
    void started?.catch(() => undefined);
    showState();
  }
  ui.on("discard-transcription", "click", cancelDictation);
  ui.on("cancel-dictation", "click", () => {
    if (canCancelDictation()) cancelDictation();
  });

  function stopProcessing() {
    if (!transcription.stopWaiting()) return false;
    dictationOperation += 1;
    recordingStart = null;
    operationBusy = false;
    showState();
    return true;
  }
  ui.on("stop-waiting", "click", stopProcessing);

  function confirmAvailableText(choice: RecoveryCopyChoice): Promise<boolean> {
    if (ports.recoveryDialog().open) return Promise.resolve(false);
    const original = choice.source === "original";
    ui.control("recovery-confirm-label").text = original
      ? "Original transcript · cleanup skipped"
      : "Provisional live words · final transcription skipped";
    ui.control("recovery-confirm-warning").text = original
      ? "Use the original transcript without cleanup? It may have unpolished punctuation and spoken fillers. Confirming stops waiting for cleanup and copies these words."
      : "Use these provisional live words? They may be incomplete, contain gaps or recognition errors, and have not been verified against the full recording. They are not the final transcript. Confirming copies these words for manual pasting.";
    if (choice.stopWaiting && !original)
      ui.control("recovery-confirm-warning").text +=
        " It also stops waiting for final transcription; your recording stays available for retry.";
    ui.control("recovery-confirm-text").value = choice.text;
    ui.control("recovery-confirm-cancel").text = choice.stopWaiting
      ? "Keep waiting"
      : "Cancel";
    ports.recoveryDialog().returnValue = "cancel";
    return new Promise((resolve) => {
      ports.recoveryDialog().addEventListener(
        "close",
        () => {
          resolve(ports.recoveryDialog().returnValue === "copy");
          showState();
        },
        { once: true },
      );
      flushSync(() => ui.flush());
      ports.recoveryDialog().showModal();
      showState();
      ui.focus("recovery-confirm-cancel");
    });
  }

  async function copyRecoveryChoice(
    choice: RecoveryCopyChoice,
    withoutBackup = false,
  ) {
    const resultStatus = ui.control("recovery-copy-status");
    let accepted = false;
    try {
      const copied = await confirmRecoveryCopy(choice, {
        confirm: async (snapshot) => {
          accepted = await confirmAvailableText(snapshot);
          return accepted;
        },
        isCurrent: (snapshot) =>
          snapshot.sessionId === transcription.sessionId &&
          !transcription.discarded &&
          !transcription.inserting &&
          (!snapshot.stopWaiting || transcription.busy),
        stopWaiting: stopProcessing,
        copy: async (text) => {
          operationBusy = true;
          showState();
          try {
            await invoke<string>("copy_dictation_text", {
              text,
              withoutBackup,
            });
            resultStatus.text = `${choice.source === "original" ? "Original transcript" : "Provisional live words"} copied. Return to your intended text field and press Ctrl+V. Review the words before pasting.`;
            provisionalCopyStatus.text = resultStatus.text;
            ui.control("copy-status").text = resultStatus.text;
          } finally {
            operationBusy = false;
            await refreshRestoreButton();
            showState();
          }
        },
      });
      if (!copied && accepted) {
        const message =
          "Processing finished or the dictation changed while you reviewed these words. Nothing was copied. Review the current result and check your destination before copying again.";
        ui.control("copy-status").text = message;
        provisionalCopyStatus.text = message;
      }
    } catch {
      resultStatus.text =
        "Copy failed. Your words remain available. Select and copy them, or use Clipboard options to replace the clipboard.";
      provisionalCopyStatus.text = resultStatus.text;
    }
  }
  ui.on("bypass-processing", "click", () => {
    if (!transcription.busy || transcription.inserting || held || operationBusy)
      return;
    const text = transcription.transcript || provisionalRecoveryText(true);
    if (text)
      void copyRecoveryChoice({
        sessionId: transcription.sessionId,
        text,
        source: transcription.transcript ? "original" : "provisional",
        stopWaiting: true,
      });
  });

  async function copySessionText(
    withoutBackup: boolean,
    source: "output" | "original" | "provisional",
  ) {
    if (held || operationBusy || transcription.busy || transcription.inserting)
      return;
    const text =
      source === "provisional"
        ? provisionalRecoveryText()
        : source === "original"
          ? transcription.transcript
          : transcription.outputText;
    if (!text) return;
    if (source === "provisional") {
      await copyRecoveryChoice(
        {
          sessionId: transcription.sessionId,
          text,
          source: "provisional",
          stopWaiting: false,
        },
        withoutBackup,
      );
      return;
    }
    const resultStatus = ui.control("copy-status");
    operationBusy = true;
    showState();
    try {
      const result = await invoke<string>("copy_dictation_text", {
        text,
        withoutBackup,
      });
      resultStatus.text =
        result +
        " Return to your intended text field and press Ctrl+V to paste.";
    } catch {
      resultStatus.text =
        "Copy failed. Restore the previous clipboard, or open Clipboard options and choose Replace clipboard if you want to replace its contents.";
    } finally {
      operationBusy = false;
      await refreshRestoreButton();
      showState();
    }
  }
  ui.on("copy-transcript", "click", () => {
    void copySessionText(false, "output");
  });
  ui.on("copy-transcript-without-backup", "click", () => {
    void copySessionText(true, "output");
  });
  ui.on("copy-original", "click", () => {
    void copySessionText(false, "original");
  });
  ui.on("copy-original-without-backup", "click", () => {
    void copySessionText(true, "original");
  });
  ui.on("copy-provisional", "click", () => {
    void copySessionText(false, "provisional");
  });
  ui.on("copy-provisional-without-backup", "click", () => {
    void copySessionText(true, "provisional");
  });

  ui.on("hotkey-action", "change", () => {
    if (actionSelect.value === "insert") {
      insertionStatus.text = "Ready. The target will be captured on key-down.";
    } else {
      insertionStatus.text =
        "Choose “Run text insertion probe” as the hotkey action to test a target.";
    }
  });

  const onDeviceChange = () => {
    void refreshMicrophones(false).catch(() => undefined);
  };
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
  cleanups.push(() =>
    navigator.mediaDevices?.removeEventListener?.(
      "devicechange",
      onDeviceChange,
    ),
  );

  ui.on("microphone", "change", () => {
    preferredMicrophone = microphoneSelect.value;
    savePreferences();
  });
  cleanups.push(
    ui.onKeyState(({ state }) => {
      apiKeyState = state;
      if (
        apiKeyState === "saved" &&
        !attemptedMicrophoneAccess &&
        !held &&
        !operationBusy &&
        !transcription.busy
      )
        void prepareMicrophone();
      showHomeState();
    }),
  );

  showState();
  void refreshRestoreButton();
  void refreshMicrophones().catch((error: unknown) => {
    recordingStatus.text = "Could not list microphones: " + String(error);
  });
  void applyShortcut(shortcutInput.value);

  // Fixture hook insertion point
  const dispose = () => {
    for (const cleanup of cleanups) cleanup();
    void escapeBinding.setActive(false);
    void shortcutBinding.suspend();
    live.cancel();
    recorder.cancelStartup();
    void recorder
      .stop()
      .catch(() => undefined)
      .finally(() => {
        ports.playback().pause();
        if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      });
  };
  window.addEventListener("pagehide", dispose, { once: true });
}
