import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { encodeWav, microphoneErrorMessage, PcmRecorder, type CapturedPcm } from "./audioCapture";

type HotkeyAction = "record" | "insert";

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
  const locked = held || operationBusy;
  actionSelect.disabled = locked;
  microphoneSelect.disabled = locked;
  refreshDevicesButton.disabled = locked;
  prepareMicrophoneButton.disabled = locked;
  playRecordingButton.disabled = locked || !recorder.hasPlayableRecording || !recordingPlayback.paused;
  stopPlaybackButton.disabled = locked || recordingPlayback.paused;
  clearRecordingButton.disabled = locked || !recorder.hasRecording;
}

async function refreshRestoreButton() {
  try {
    restoreButton.disabled = !(await invoke<boolean>("has_clipboard_backup"));
  } catch {
    restoreButton.disabled = true;
  }
}

function displayRecording(recording: CapturedPcm) {
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
    playbackUrl = URL.createObjectURL(encodeWav(recording));
    recordingPlayback.src = playbackUrl;
    recordingPlayback.hidden = false;
    recordingPlayback.load();
    inputLevelStatus.textContent = "Audio samples received. Playback is ready.";
    recordingStatus.textContent = "Recording stopped. In-memory WAV playback is ready.";
  } else {
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
    captureInterruptionMessage = message;
    displayRecording(recording);
    recordingStatus.textContent = message;
    log("microphone disconnected; partial audio retained in memory");
  },
  (message) => {
    recordingStatus.textContent = `Microphone capture stopped: ${message}`;
    log("microphone capture stopped unexpectedly");
  },
  (rms) => {
    inputLevelMeter.value = Math.min(rms, 0.5);
    inputLevelStatus.textContent = `Input level: ${(rms * 100).toFixed(1)}% RMS`;
  },
);

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

async function finishRecording(started: Promise<string> | null) {
  operationBusy = true;
  showState();
  try {
    await started;
    const recording = await recorder.stop();
    displayRecording(recording);
    if (captureInterruptionMessage) recordingStatus.textContent = captureInterruptionMessage;
    void refreshMicrophones(false).catch(() => undefined);
  } catch (error) {
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
    if (held || operationBusy) return;
    const requestedAction = actionSelect.value === "insert" ? "insert" : "record";
    if (requestedAction === "record" && !microphonePrepared) {
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
      insertionStatus.textContent = "Capturing the focused target…";
      return;
    }

    if (recorder.hasRecording) {
      recordingStatus.textContent = "Clear the previous recording before starting another.";
      recordingStart = Promise.reject(new Error("Clear the previous recording before starting another."));
    } else {
      recordingStatus.textContent = "Requesting microphone access…";
      recordingStart = recorder.start(microphoneSelect.value)
        .then(async (message) => {
          recordingStatus.textContent = "Listening… " + message;
          log("microphone recording started");
          void refreshMicrophones(false).catch(() => undefined);
          return message;
        })
        .catch((error: unknown) => {
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
    } else if (action === "record") {
      recordingStatus.textContent = "Stopping recording…";
      finishRecording(recordingStart);
    }
  }
}

async function applyShortcut(shortcut: string) {
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
  try {
    insertionStatus.textContent = await invoke<string>("restore_previous_clipboard");
  } catch (error) {
    insertionStatus.textContent = "Restore failed: " + String(error);
  } finally {
    await refreshRestoreButton();
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
  try {
    recordingPlayback.pause();
    recordingPlayback.removeAttribute("src");
    recordingPlayback.load();
    recordingPlayback.hidden = true;
    recordingPlayback.currentTime = 0;
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
    recorder.clear();
    captureInterruptionMessage = null;
    inputLevelMeter.value = 0;
    inputLevelStatus.textContent = "Waiting for recording.";
    recordingMetadata.textContent = "No recording retained.";
    recordingStatus.textContent = "Recording cleared from memory.";
    log("recording cleared from memory");
    showState();
  } catch (error) {
    recordingStatus.textContent = String(error);
  }
});

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
void refreshRestoreButton();
void refreshMicrophones().catch((error: unknown) => {
  recordingStatus.textContent = "Could not list microphones: " + String(error);
});
void applyShortcut(shortcutInput.value);
