import { Channel, invoke } from "@tauri-apps/api/core";
import type { CapturedPcm } from "./audioCapture";

// Same contract as PcmRecorder, backed by native capture. The native side sends
// raw mono Float32 chunks, then {"type":"ended"} on device loss and
// {"type":"flushed"} after the last chunk when stopped.
type NativeEvent = ArrayBuffer | number[] | { type: "ended" } | { type: "flushed"; callbacks?: number };

export interface NativeCaptureTransport {
  start(deviceName: string, onEvent: (event: NativeEvent) => void): Promise<{
    sampleRate: number;
    channelCount: number;
    deviceName: string;
  }>;
  stop(): Promise<{ callbacks: number }>;
}

const tauriTransport: NativeCaptureTransport = {
  start: (deviceName, onEvent) =>
    invoke("start_native_capture", { deviceName: deviceName || null, events: new Channel<NativeEvent>(onEvent) }),
  stop: () => invoke("stop_native_capture"),
};

// Native failures map to the DOMException names microphoneErrorMessage handles.
const errorNames: Record<string, string> = {
  microphone_denied: "NotAllowedError",
  microphone_device_missing: "OverconstrainedError",
  microphone_unavailable: "NotFoundError",
};

function nativeError(error: unknown): Error {
  const code = String(error);
  return new DOMException("The microphone could not be opened.", errorNames[code] ?? "NotReadableError");
}

async function deviceLabel(deviceId: string): Promise<string> {
  if (!deviceId) return "";
  const devices = await navigator.mediaDevices?.enumerateDevices?.() ?? [];
  const device = devices.find((item) => item.kind === "audioinput" && item.deviceId === deviceId);
  if (!device?.label) throw new DOMException("The selected microphone is no longer available.", "OverconstrainedError");
  return device.label;
}

export class NativePcmRecorder {
  private chunks: Float32Array[] = [];
  private frameCount = 0;
  private active = false;
  private acceptingPcm = false;
  private ended = false;
  private pendingFlush: (() => void) | null = null;
  private finishPromise: Promise<CapturedPcm> | null = null;
  private stopPending = false;
  private lastCaptured: CapturedPcm | null = null;
  private sampleRate = 0;
  private channelCount = 0;
  private deviceId = "";
  private deviceLabel = "";
  private startPending = false;
  private startGeneration = 0;

  constructor(
    private readonly onUnexpectedStop: (recording: CapturedPcm, message: string) => void,
    private readonly onUnexpectedError: (message: string) => void,
    private readonly onInputLevel: (rms: number) => void,
    private readonly onPcmChunk?: (samples: Float32Array, sampleRate: number) => void,
    private readonly transport: NativeCaptureTransport = tauriTransport,
  ) {}

  get isRecording(): boolean { return this.active; }
  get isStopping(): boolean { return this.stopPending; }
  get hasRecording(): boolean { return this.lastCaptured !== null; }
  get hasPlayableRecording(): boolean { return (this.lastCaptured?.frameCount ?? 0) > 0; }
  get activeDeviceId(): string { return this.deviceId; }

  async start(deviceId: string): Promise<string> {
    if (this.stopPending) throw new Error("Microphone capture is still stopping.");
    if (this.startPending) throw new Error("Microphone startup is still finishing.");
    this.startPending = true;
    const generation = ++this.startGeneration;
    try { return await this.startCapture(deviceId, generation); }
    finally { if (generation === this.startGeneration) this.startPending = false; }
  }

  cancelStartup() { this.startGeneration += 1; this.startPending = false; }

  private async startCapture(deviceId: string, generation: number): Promise<string> {
    if (this.active) throw new Error("A microphone recording is already active.");
    if (this.lastCaptured) throw new Error("Clear the previous recording before starting another.");
    this.chunks = [];
    this.frameCount = 0;
    this.finishPromise = null;
    this.ended = false;
    this.onInputLevel(0);

    const label = await deviceLabel(deviceId);
    if (generation !== this.startGeneration) throw new DOMException("Recording cancelled.", "AbortError");
    this.acceptingPcm = true;
    let started;
    try {
      started = await this.transport.start(label, (event) => this.receive(event, generation));
    } catch (error) {
      if (generation === this.startGeneration) this.acceptingPcm = false;
      throw nativeError(error);
    }
    if (generation !== this.startGeneration) {
      // Startup was cancelled while native capture was opening; release it.
      await this.transport.stop().catch(() => undefined);
      throw new DOMException("Recording cancelled.", "AbortError");
    }
    this.sampleRate = started.sampleRate;
    this.channelCount = started.channelCount;
    this.deviceId = deviceId;
    this.deviceLabel = started.deviceName || label || "System default microphone";
    this.active = true;
    return `Recording from ${this.deviceLabel} at ${this.sampleRate.toLocaleString()} Hz.`;
  }

  private receive(event: NativeEvent, generation: number) {
    if (event instanceof ArrayBuffer || Array.isArray(event)) {
      if (!this.acceptingPcm || generation !== this.startGeneration) return;
      const bytes = event instanceof ArrayBuffer ? event : new Uint8Array(event).buffer;
      const samples = new Float32Array(bytes.slice(0, bytes.byteLength - (bytes.byteLength % 4)));
      this.chunks.push(samples);
      this.frameCount += samples.length;
      // Store original samples first. A failed preview cannot stop capture.
      try { this.onPcmChunk?.(samples, this.sampleRate); } catch { /* Preview is optional. */ }
      let sumSquares = 0;
      for (const sample of samples) sumSquares += sample * sample;
      this.onInputLevel(Math.sqrt(sumSquares / Math.max(1, samples.length)));
    } else if (event.type === "flushed") {
      this.pendingFlush?.();
    } else if (event.type === "ended") {
      if (!this.active || generation !== this.startGeneration) return;
      this.ended = true;
      const message = "The microphone disconnected. The audio captured so far is retained in memory.";
      void this.stop()
        .then((recording) => { if (generation === this.startGeneration) this.onUnexpectedStop(recording, message); })
        .catch((error: unknown) => {
          if (generation === this.startGeneration) this.onUnexpectedError(error instanceof Error ? error.message : String(error));
        });
    }
  }

  stop(): Promise<CapturedPcm> {
    if (this.finishPromise) return this.finishPromise;
    if (!this.active) {
      if (this.lastCaptured) return Promise.resolve(this.lastCaptured);
      return Promise.reject(new Error("There is no active recording to stop."));
    }
    this.active = false;
    this.stopPending = true;
    this.finishPromise = (async () => {
      const flushed = new Promise<void>((resolve) => {
        const timeout = setTimeout(finish, 1500);
        function finish() { clearTimeout(timeout); resolve(); }
        this.pendingFlush = finish;
      });
      let callbacks = 0;
      try { callbacks = (await this.transport.stop()).callbacks; }
      catch { this.pendingFlush?.(); }
      await flushed;
      this.pendingFlush = null;
      this.acceptingPcm = false;

      const samples = new Float32Array(this.frameCount);
      let offset = 0;
      for (const chunk of this.chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      this.chunks = [];
      const recording: CapturedPcm = {
        samples: [samples],
        sampleRate: this.sampleRate,
        channelCount: 1,
        frameCount: this.frameCount,
        deviceId: this.deviceId,
        deviceLabel: this.deviceLabel,
        durationSeconds: this.sampleRate > 0 ? this.frameCount / this.sampleRate : 0,
        audioContextState: "not used (native capture)",
        trackState: this.ended ? "ended" : "live",
        trackMuted: false,
        workletProcessCalls: callbacks,
        workletInputChannels: this.channelCount,
      };
      this.lastCaptured = recording;
      return recording;
    })().finally(() => { this.stopPending = false; });
    return this.finishPromise;
  }

  clear(): void {
    if (this.stopPending) throw new Error("Wait for microphone capture to stop before clearing it.");
    if (this.active) throw new Error("Stop the recording before clearing it.");
    this.lastCaptured = null;
    this.finishPromise = null;
    this.acceptingPcm = false;
    this.pendingFlush = null;
    this.chunks = [];
    this.frameCount = 0;
    this.sampleRate = 0;
    this.channelCount = 0;
    this.deviceId = "";
    this.deviceLabel = "";
    this.onInputLevel(0);
  }
}
