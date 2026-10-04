import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { encodeWav, microphoneErrorMessage, PcmRecorder, type CapturedPcm } from "./audioCapture";
import { initializeApiKeySettings } from "./apiKey";
import { TranscriptionSession, type InsertionResult } from "./transcriptionSession";
import { transcriptionError } from "./transcription";
import { LiveTranscription } from "./liveTranscription";
import { nativeStreamingSTT } from "./liveTransport";

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
const applyShortcutButton = document.querySelector<HTMLButtonElement>("#shortcut-form button")!;
const liveEnabled = document.querySelector<HTMLInputElement>("#live-enabled")!;
const liveView = document.querySelector<HTMLTextAreaElement>("#live-transcript")!;
const liveStatus = document.querySelector<HTMLElement>("#live-status")!;
const liveLatency = document.querySelector<HTMLElement>("#live-latency")!;
const liveReconnect = document.querySelector<HTMLButtonElement>("#live-reconnect")!;

let activeShortcut: string | null = null;
let held = false;
let heldAction: HotkeyAction | null = null;
let insertionCapture: Promise<string> | null = null;
let recordingStart: Promise<string> | null = null;
let operationBusy = false;
let playbackUrl: string | null = null;
let captureInterruptionMessage: string | null = null;
let microphonePrepared = false;

function log(message: string) {
  const line = new Date().toISOString() + "  " + message;
  const item = document.createElement("li");
  item.textContent = line;
  events.prepend(item);
  console.info(line);
}

function showState() {
  holdState.textContent = held ? "DOWN" : "UP";
  const locked = held || operationBusy || transcription.busy;
  liveEnabled.disabled = locked || !transcription.canStart;
  liveReconnect.disabled = !recorder.isRecording || live.state !== "failed";
  applyShortcutButton.disabled = locked;
  shortcutInput.disabled = locked;
  actionSelect.disabled = locked;
  microphoneSelect.disabled = locked;
  refreshDevicesButton.disabled = locked;
  prepareMicrophoneButton.disabled = locked;
  playRecordingButton.disabled = locked || !recorder.hasPlayableRecording || !recordingPlayback.paused;
  stopPlaybackButton.disabled = locked || recordingPlayback.paused;
  clearRecordingButton.disabled = locked || !recorder.hasRecording;
  transcribeButton.disabled = locked || !transcription.audio || !recordingPlayback.paused;
  transcribeButton.textContent = "Retry transcription";
  discardButton.disabled = transcription.inserting || transcription.state === "idle" || transcription.state === "discarded";
  if (operationBusy && !recordingStart) discardButton.disabled = true;
  discardButton.textContent = held || transcription.busy ? "Cancel and discard" : "Discard recording and transcript";
  copyTranscriptButton.disabled = locked || !transcription.transcript;
  copyTranscriptWithoutBackupButton.disabled = locked || !transcription.transcript;
  sessionState.textContent = transcription.state;
  document.querySelector<HTMLButtonElement>("#copy-text")!.disabled = locked;
  document.querySelector<HTMLButtonElement>("#copy-without-backup")!.disabled = locked;
  transcriptView.value = transcription.transcript;
  if (transcription.discarded) {
    transcriptionStatus.textContent = transcription.busy
      ? "Discarded locally. Waiting for the sent request to finish; its response will be ignored."
      : "Recording and transcript discarded. Ready for another recording.";
  } else if (transcription.inserting) {
    transcriptionStatus.textContent = "Checking the original destination and sending paste. Wait for its result before discarding.";
  } else if (transcription.busy) {
    transcriptionStatus.textContent = "Sending this recording directly to OpenAI and waiting for the canonical transcript…";
  } else if (transcription.state === "recording") {
    transcriptionStatus.textContent = actionSelect.value === "live"
      ? "Listening. Release retains the recording for playback or explicit transcription."
      : "Listening. Release the shortcut to transcribe and insert.";
  } else if (transcription.insertion) {
    transcriptionStatus.textContent = transcription.insertion.message
      + (transcription.canRetryInsertion ? " Return to the original input/caret and pointer position, then press and release the shortcut to retry insertion, or use Copy transcript." : " Transcript is retained until discard.");
  } else if (transcription.transcript && transcription.error) {
    transcriptionStatus.textContent = "The destination is unavailable or the paste outcome is uncertain. Check the target and use Copy transcript. Text is retained until discard.";
  } else if (transcription.error) {
    transcriptionStatus.textContent = transcriptionError(transcription.error) + " Audio is retained in memory until you discard it or quit.";
  } else if (transcription.transcript) {
    transcriptionStatus.textContent = "Canonical transcript ready. Audio released from memory. Text stays here until you discard it or quit.";
  } else {
    transcriptionStatus.textContent = transcription.audio
      ? "Recording retained. Choose Retry transcription to send it to OpenAI."
      : actionSelect.value === "live" ? "Prepare the microphone, then hold the shortcut to test live words. Release retains audio."
      : "Prepare the microphone, then hold the shortcut in your destination. Release transcribes and inserts.";
  }
}

function showLiveState() {
  liveView.value = live.text;
  liveLatency.textContent = live.firstVisibleMs === null ? "First visible text: waiting" : `First visible text: ${Math.round(live.firstVisibleMs)} ms after capture started`;
  const labels = { idle: "Live preview ready.", connecting: "Connecting live preview…", listening: "Receiving provisional words while you speak.",
    finishing: "Finishing live preview. Canonical transcription proceeds independently.", completed: "Live preview complete; this text remains provisional.",
    failed: `${live.error} Local capture and final transcription remain available.`, discarded: "Live preview cleared." };
  liveStatus.textContent = labels[live.state] + (live.hasGap ? " This preview contains a connection gap; final transcription uses the complete original audio." : "");
  liveReconnect.disabled = !recorder.isRecording || live.state !== "failed";
}

const live = new LiveTranscription(nativeStreamingSTT, showLiveState);
actionSelect.addEventListener("change", showState);
liveReconnect.addEventListener("click", () => {
  if (recorder.isRecording) live.reconnect();
});

async function refreshRestoreButton() {
  try {
    restoreButton.disabled = !(await invoke<boolean>("has_clipboard_backup")) || held || operationBusy || transcription.busy;
  } catch {
    restoreButton.disabled = true;
  }
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
    capture: (sessionId) => invoke<void>("capture_dictation_target", { sessionId }),
    insert: (sessionId, text) => invoke<InsertionResult>("insert_dictation_text", { sessionId, text }),
    discard: (sessionId) => invoke<void>("discard_dictation_target", { sessionId }),
  },
);

function releaseRecording() {
  // Recording cancellation stops the graph asynchronously before clearing it.
  if (recorder.isRecording) return;
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

  const previous = microphoneSelect.value;
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
  }

  if (devices.length === 0 && reportEmptyList && !recorder.isRecording) {
    recordingStatus.textContent = "No microphone is listed. The system default may still work; connect an input or check Windows microphone access.";
  }
}

async function prepareMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    recordingStatus.textContent = "Microphone capture is unavailable in this app environment.";
    return;
  }

  operationBusy = true;
  microphonePrepared = false;
  recordingStatus.textContent = "Requesting microphone access…";
  showState();

  let stream: MediaStream | null = null;
  try {
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
    microphonePrepared = true;
    recordingStatus.textContent = `Microphone ready: ${label}${sampleRate ? ` (${sampleRate.toLocaleString()} Hz)` : ""}. Hold the shortcut to record.`;
    log("microphone permission prepared");
  } catch (error) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    recordingError(error);
  } finally {
    operationBusy = false;
    showState();
  }
}

function recordingError(error: unknown) {
  const message = microphoneErrorMessage(error);
  recordingStatus.textContent = message;
  log("microphone start failed: " + message);
}

async function finishRecording(started: Promise<string> | null, autoTranscribe = true) {
  operationBusy = true;
  showState();
  try {
    await started;
    const recording = await recorder.stop();
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
    recordingStart = null;
    operationBusy = false;
    showState();
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
    if (requestedAction !== "insert" && !transcription.canStart) {
      recordingStatus.textContent = "Discard the previous recording or transcript before starting another.";
      return;
    }
    if (requestedAction !== "insert" && !microphonePrepared) {
      recordingStatus.textContent = "Click Prepare microphone and allow access before using the recording shortcut.";
      log("recording skipped; microphone permission has not been prepared");
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

    transcription.begin(heldAction !== "live");
    if (liveEnabled.checked) live.begin();

    if (recorder.hasRecording) {
      recordingStatus.textContent = "Clear the previous recording before starting another.";
      recordingStart = Promise.reject(new Error("Clear the previous recording before starting another."));
    } else {
      recordingStatus.textContent = "Requesting microphone access…";
      recordingStart = recorder.start(microphoneSelect.value)
        .then(async (message) => {
          if (transcription.discarded) return message;
          live.captureStarted();
          recordingStatus.textContent = "Listening… " + message;
          log("microphone recording started");
          void refreshMicrophones(false).catch(() => undefined);
          return message;
        })
        .catch((error: unknown) => {
          live.cancel();
          transcription.failRecording();
          recordingError(error);
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
    status.textContent = "Enter a shortcut first.";
    return;
  }
  if (next === activeShortcut) return;

  try {
    await register(next, onShortcut);
    if (activeShortcut) await unregister(activeShortcut);
    activeShortcut = next;
    held = false;
    heldAction = null;
    showState();
    status.textContent = "Registered: " + next;
    log("registered " + next);
  } catch (error) {
    status.textContent = "Registration failed: " + String(error);
    log("registration failed for " + next + ": " + String(error));
  }
}

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
discardButton.addEventListener("click", () => {
  if (transcription.inserting) return;
  const stoppingCapture = heldAction === "record" || heldAction === "live" || recorder.isRecording;
  const started = recordingStart;
  held = false;
  heldAction = null;
  if (!transcription.discard()) return;
  live.cancel();
  if (stoppingCapture) {
    operationBusy = true;
    showState();
    void (async () => {
      try { await started; await recorder.stop(); }
      catch { /* Nothing usable remains after explicit discard. */ }
      finally { releaseRecording(); recordingStart = null; operationBusy = false; showState(); }
    })();
  }
});

async function copyTranscript(withoutBackup: boolean) {
  if (held || operationBusy || transcription.busy || !transcription.transcript) return;
  operationBusy = true;
  showState();
  try {
    insertionStatus.textContent = await invoke<string>("copy_dictation_text", {
      text: transcription.transcript, withoutBackup,
    });
  } catch {
    insertionStatus.textContent = "Copy failed. Restore a pending clipboard backup, or use Copy transcript without backup to explicitly replace unsupported clipboard contents.";
  } finally { operationBusy = false; await refreshRestoreButton(); showState(); }
}
copyTranscriptButton.addEventListener("click", () => { void copyTranscript(false); });
copyTranscriptWithoutBackupButton.addEventListener("click", () => { void copyTranscript(true); });

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

showState();
initializeApiKeySettings();
void refreshRestoreButton();
void refreshMicrophones().catch((error: unknown) => {
  recordingStatus.textContent = "Could not list microphones: " + String(error);
});
void applyShortcut(shortcutInput.value);
