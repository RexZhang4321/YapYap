export interface CapturedPcm {
  samples: Float32Array[];
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  deviceId: string;
  deviceLabel: string;
  durationSeconds: number;
  audioContextState: string;
  trackState: string;
  trackMuted: boolean;
  workletProcessCalls: number;
  workletInputChannels: number;
}

export class PcmRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private endedHandler: (() => void) | null = null;
  private chunks: Float32Array[] = [];
  private frameCount = 0;
  private active = false;
  private acceptingPcm = false;
  private pendingFlush: (() => void) | null = null;
  private workletProcessCalls = 0;
  private workletInputChannels = 0;
  private finishPromise: Promise<CapturedPcm> | null = null;
  private lastCaptured: CapturedPcm | null = null;
  private sampleRate = 0;
  private deviceId = "";
  private deviceLabel = "";

  constructor(
    private readonly onUnexpectedStop: (recording: CapturedPcm, message: string) => void,
    private readonly onUnexpectedError: (message: string) => void,
    private readonly onInputLevel: (rms: number) => void,
    private readonly onPcmChunk?: (samples: Float32Array, sampleRate: number) => void,
  ) {}

  get isRecording(): boolean {
    return this.active;
  }

  get hasRecording(): boolean {
    return this.lastCaptured !== null;
  }

  get hasPlayableRecording(): boolean {
    return (this.lastCaptured?.frameCount ?? 0) > 0;
  }

  get activeDeviceId(): string {
    return this.deviceId;
  }

  async start(deviceId: string): Promise<string> {
    if (this.active) throw new Error("A microphone recording is already active.");
    if (this.lastCaptured) throw new Error("Clear the previous recording before starting another.");
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is unavailable in this app environment.");
    }

    this.chunks = [];
    this.frameCount = 0;
    this.finishPromise = null;
    this.workletProcessCalls = 0;
    this.workletInputChannels = 0;
    this.onInputLevel(0);

    const audio: MediaTrackConstraints = {
      channelCount: { ideal: 1 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };

    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: AudioWorkletNode | null = null;
    try {
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("The selected input did not provide an audio track.");

      context = new AudioContext({ latencyHint: "interactive" });
      await context.resume();
      await context.audioWorklet.addModule(new URL("pcm-capture-worklet.js", window.location.href));

      source = context.createMediaStreamSource(stream);
      processor = new AudioWorkletNode(context, "byok-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
        outputChannelCount: [1],
      });
      processor.port.onmessage = (event: MessageEvent<{
        type: string;
        buffer?: ArrayBuffer;
        processCalls?: number;
        inputChannels?: number;
      }>) => {
        if (event.data.type === "pcm" && event.data.buffer && this.acceptingPcm) {
          const samples = new Float32Array(event.data.buffer);
          this.chunks.push(samples);
          this.frameCount += samples.length;
          // Store original samples first. A failed preview cannot stop capture.
          try { this.onPcmChunk?.(samples, context!.sampleRate); } catch { /* Preview is optional. */ }
          let sumSquares = 0;
          for (const sample of samples) sumSquares += sample * sample;
          this.onInputLevel(Math.sqrt(sumSquares / Math.max(1, samples.length)));
        } else if (event.data.type === "diagnostics") {
          this.workletProcessCalls = event.data.processCalls ?? this.workletProcessCalls;
          this.workletInputChannels = event.data.inputChannels ?? this.workletInputChannels;
        } else if (event.data.type === "flushed") {
          this.pendingFlush?.();
        }
      };

      this.acceptingPcm = true;
      source.connect(processor);
      processor.connect(context.destination);

      this.stream = stream;
      this.context = context;
      this.source = source;
      this.processor = processor;
      this.sampleRate = context.sampleRate;
      this.deviceId = track.getSettings().deviceId || deviceId;
      this.deviceLabel = track.label || (deviceId ? "Selected microphone" : "System default microphone");
      this.active = true;

      this.endedHandler = () => {
        if (!this.active) return;
        const message = "The microphone disconnected. The audio captured so far is retained in memory.";
        void this.stop()
          .then((recording) => this.onUnexpectedStop(recording, message))
          .catch((error: unknown) => this.onUnexpectedError(errorMessage(error)));
      };
      track.addEventListener("ended", this.endedHandler, { once: true });

      return `Recording from ${this.deviceLabel} at ${this.sampleRate.toLocaleString()} Hz.`;
    } catch (error) {
      this.active = false;
      this.acceptingPcm = false;
      if (processor) {
        processor.port.onmessage = null;
        try { processor.disconnect(); } catch { /* Already disconnected. */ }
        processor.port.close();
      }
      if (source) {
        try { source.disconnect(); } catch { /* Already disconnected. */ }
      }
      for (const track of stream.getTracks()) track.stop();
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
      this.stream = null;
      this.context = null;
      this.source = null;
      this.processor = null;
      this.endedHandler = null;
      throw error;
    }
  }

  stop(): Promise<CapturedPcm> {
    if (this.finishPromise) return this.finishPromise;
    if (!this.active) {
      if (this.lastCaptured) return Promise.resolve(this.lastCaptured);
      return Promise.reject(new Error("There is no active recording to stop."));
    }

    this.active = false;
    const stream = this.stream;
    const context = this.context;
    const source = this.source;
    const processor = this.processor;
    const endedHandler = this.endedHandler;
    const sampleRate = this.sampleRate;
    const deviceId = this.deviceId;
    const deviceLabel = this.deviceLabel;
    const audioContextState = context?.state ?? "unavailable";
    const track = stream?.getAudioTracks()[0] ?? null;
    const trackState = track?.readyState ?? "unavailable";
    const trackMuted = track?.muted ?? true;

    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.endedHandler = null;

    this.finishPromise = (async () => {
      if (stream) {
        const track = stream.getAudioTracks()[0];
        if (track && endedHandler) track.removeEventListener("ended", endedHandler);
        for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
      }
      if (processor) await this.flushWorklet(processor);
      this.acceptingPcm = false;
      if (processor) {
        processor.port.onmessage = null;
        try { processor.disconnect(); } catch { /* Already disconnected. */ }
        processor.port.close();
      }
      if (source) {
        try { source.disconnect(); } catch { /* Already disconnected. */ }
      }
      if (context && context.state !== "closed") await context.close().catch(() => undefined);

      const samples = new Float32Array(this.frameCount);
      let offset = 0;
      for (const chunk of this.chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      this.chunks = [];

      const recording: CapturedPcm = {
        samples: [samples],
        sampleRate,
        channelCount: 1,
        frameCount: this.frameCount,
        deviceId,
        deviceLabel,
        durationSeconds: sampleRate > 0 ? this.frameCount / sampleRate : 0,
        audioContextState,
        trackState,
        trackMuted,
        workletProcessCalls: this.workletProcessCalls,
        workletInputChannels: this.workletInputChannels,
      };
      this.lastCaptured = recording;
      return recording;
    })();

    return this.finishPromise;
  }

  private flushWorklet(processor: AudioWorkletNode): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.pendingFlush = null;
        resolve();
      };
      const timeout = setTimeout(finish, 1500);
      this.pendingFlush = finish;
      processor.port.postMessage({ type: "flush" });
    });
  }

  clear(): void {
    if (this.active) throw new Error("Stop the recording before clearing it.");
    this.lastCaptured = null;
    this.finishPromise = null;
    this.acceptingPcm = false;
    this.pendingFlush = null;
    this.workletProcessCalls = 0;
    this.workletInputChannels = 0;
    this.chunks = [];
    this.frameCount = 0;
    this.sampleRate = 0;
    this.deviceId = "";
    this.deviceLabel = "";
    this.onInputLevel(0);
  }
}

export function encodeWav(recording: CapturedPcm): Blob {
  const channels = recording.channelCount;
  const frames = recording.frameCount;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, recording.sampleRate, true);
  view.setUint32(28, recording.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, recording.samples[channel]?.[frame] ?? 0));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function microphoneErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name)
    : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was denied. Allow microphone access for this app in Windows settings, then refresh the device list and try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone input is available. Connect a microphone and refresh the device list.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "The microphone could not be opened. Check that it is connected and available to this app.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "The selected microphone is no longer available. Choose another input and try again.";
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
