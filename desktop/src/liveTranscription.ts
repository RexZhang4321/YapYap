export interface LiveEvent {
  streamId: string;
  kind: "ready" | "delta" | "completed" | "error" | "closed";
  itemId?: string;
  text?: string;
  code?: string;
}

export interface StreamingSTT {
  start(streamId: string, receive: (event: LiveEvent) => void): Promise<void>;
  append(streamId: string, audio: Uint8Array): Promise<void>;
  finish(streamId: string): Promise<void>;
  cancel(streamId: string): Promise<void>;
}

// Area averaging carries fractional source samples across worklet boundaries.
// Only this preview copy is resampled; the original capture remains untouched.
export class Pcm16Resampler {
  private area = 0;
  private filled = 0;
  private readonly ratio: number;
  constructor(sourceRate: number) {
    if (!Number.isFinite(sourceRate) || sourceRate < 8_000 || sourceRate > 192_000) throw "live_audio_invalid";
    this.ratio = sourceRate / 24_000;
  }
  push(samples: Float32Array): Uint8Array {
    const output: number[] = [];
    for (const sample of samples) {
      const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      let remaining = 1;
      while (remaining > 1e-10) {
        const count = Math.min(remaining, this.ratio - this.filled);
        this.area += value * count;
        this.filled += count;
        remaining -= count;
        if (this.filled >= this.ratio - 1e-10) {
          output.push(this.area / this.ratio);
          this.area = 0; this.filled = 0;
        }
      }
    }
    return this.encode(output);
  }
  flush(): Uint8Array {
    const output = this.filled > 1e-10 ? [this.area / this.filled] : [];
    this.area = 0; this.filled = 0;
    return this.encode(output);
  }
  private encode(samples: number[]): Uint8Array {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    samples.forEach((sample, index) => view.setInt16(index * 2, Math.trunc(sample * (sample < 0 ? 32_768 : 32_767)), true));
    return bytes;
  }
}

export const MAX_LIVE_QUEUE_BYTES = 192_000; // Four seconds of 24 kHz PCM16.
const MAX_CHUNK_BYTES = 9_600;
const MAX_TEXT = 1024 * 1024;
type LiveState = "idle" | "connecting" | "listening" | "finishing" | "completed" | "failed" | "discarded";

const errorMessages: Record<string, string> = {
  key_missing: "Save an API key to enable live transcription.",
  key_format: "The saved key could not be used. Save a replacement.",
  live_unauthorized: "OpenAI rejected the saved key for live transcription.",
  live_forbidden: "The key cannot access live transcription. Check its permissions.",
  live_model_unavailable: "gpt-live-transcribe is unavailable to this account.",
  live_rate_limited: "OpenAI returned a rate or usage limit for live transcription.",
  live_provider_unavailable: "OpenAI live transcription is temporarily unavailable.",
  live_backlog: "Live transcription could not keep up with the microphone.",
  live_timeout: "The live connection timed out.",
  live_tls_failed: "The live connection's certificate could not be verified.",
  live_disconnected: "The live connection disconnected.",
  live_stale_stream: "The live connection disconnected.",
  live_busy: "The previous live connection is still closing. Try reconnecting.",
  live_response_invalid: "OpenAI returned an unreadable live update.",
  live_response_too_large: "The live preview exceeded its size limit.",
  live_audio_invalid: "The microphone audio could not be converted for the live preview.",
  live_request_rejected: "OpenAI rejected the live transcription request.",
};
export function liveErrorMessage(error: unknown): string {
  return typeof error === "string" && Object.prototype.hasOwnProperty.call(errorMessages, error)
    ? errorMessages[error] : "Live transcription could not continue.";
}

export class LiveTranscription {
  state: LiveState = "idle";
  text = "";
  error: string | null = null;
  firstVisibleMs: number | null = null;
  hasGap = false;
  private generation = 0;
  private streamId = "";
  private captureStartedAt: number | null = null;
  private accepting = false;
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private resampler: Pcm16Resampler | null = null;
  private sampleRate = 0;
  private items = new Map<string, { text: string; completed: boolean }>();
  private prefix = "";
  private connection: Promise<void> = Promise.resolve();
  private draining: Promise<void> | null = null;
  private cancellation: Promise<void> = Promise.resolve();

  constructor(private readonly provider: StreamingSTT, private readonly changed: () => void,
    private readonly now = () => performance.now(), private readonly newId = () => crypto.randomUUID()) {}

  begin(): void {
    this.cancel();
    this.text = ""; this.prefix = ""; this.firstVisibleMs = null; this.captureStartedAt = null; this.hasGap = false;
    this.connect();
  }
  captureStarted(): void { if (this.captureStartedAt === null) this.captureStartedAt = this.now(); }

  reconnect(): void {
    if (this.state !== "failed") return;
    this.prefix = this.text;
    this.hasGap = true;
    this.connect();
  }

  private connect(): void {
    const generation = ++this.generation;
    const id = this.newId();
    this.streamId = id; this.accepting = true; this.queue = []; this.queuedBytes = 0;
    this.items.clear(); this.resampler = null; this.sampleRate = 0; this.draining = null;
    this.error = null; this.state = "connecting"; this.changed();
    this.connection = (async () => {
      await this.cancellation;
      if (generation !== this.generation) return;
      await this.provider.start(id, (event) => this.receive(event, generation));
    })().catch((error: unknown) => this.fail(error, generation));
    void this.drain(generation);
  }

  push(samples: Float32Array, sampleRate: number): void {
    if (!this.accepting) return;
    try {
      if (!this.resampler) { this.sampleRate = sampleRate; this.resampler = new Pcm16Resampler(sampleRate); }
      if (this.sampleRate !== sampleRate) throw "live_audio_invalid";
      this.enqueue(this.resampler.push(samples));
    } catch (error) { this.fail(error, this.generation); }
  }

  private enqueue(bytes: Uint8Array): void {
    if (this.queuedBytes + bytes.byteLength > MAX_LIVE_QUEUE_BYTES) { this.fail("live_backlog", this.generation); return; }
    for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_BYTES) {
      const chunk = bytes.slice(offset, offset + MAX_CHUNK_BYTES);
      this.queue.push(chunk); this.queuedBytes += chunk.length;
    }
    void this.drain(this.generation);
  }

  private drain(generation: number): Promise<void> {
    if (this.draining) return this.draining;
    const id = this.streamId;
    const draining = (async () => {
      await this.connection;
      while (generation === this.generation && this.queue.length && this.state !== "failed") {
        const bytes = this.queue.shift()!; this.queuedBytes -= bytes.length;
        await this.provider.append(id, bytes);
      }
    })().catch((error: unknown) => this.fail(error, generation)).finally(() => {
      if (generation === this.generation) this.draining = null;
    });
    this.draining = draining;
    return draining;
  }

  async finish(): Promise<void> {
    if (!this.accepting) return;
    const generation = this.generation;
    if (this.resampler) this.enqueue(this.resampler.flush());
    if (this.state === "failed") return;
    this.accepting = false; this.state = "finishing"; this.changed();
    await this.drain(generation);
    if (generation !== this.generation || this.error !== null) return;
    try { await this.provider.finish(this.streamId); }
    catch (error) { this.fail(error, generation); }
  }

  cancel(): void {
    const id = this.streamId;
    this.generation += 1; this.accepting = false; this.queue = []; this.queuedBytes = 0;
    this.resampler = null; this.draining = null; this.items.clear(); this.prefix = "";
    this.text = ""; this.error = null; this.firstVisibleMs = null; this.hasGap = false;
    this.state = "discarded"; this.streamId = "";
    if (id) this.stopNative(id);
    this.changed();
  }

  private stopNative(id: string): void {
    // Serialize shutdown before another connection. Failure remains visible on
    // a later start, but cancellation never rejects into the microphone path.
    const previous = this.cancellation;
    const connection = this.connection;
    this.cancellation = previous.then(async () => { await connection; await this.provider.cancel(id); }).catch(() => undefined);
  }

  private fail(error: unknown, generation: number): void {
    if (generation !== this.generation) return;
    this.generation += 1; this.accepting = false; this.queue = []; this.queuedBytes = 0;
    this.resampler = null; this.draining = null;
    this.error = liveErrorMessage(error); this.state = "failed";
    this.stopNative(this.streamId);
    this.changed();
  }

  private receive(event: LiveEvent, generation: number): void {
    if (generation !== this.generation || event.streamId !== this.streamId) return;
    if (event.kind === "error") { this.fail(event.code, generation); return; }
    if (event.kind === "ready") { if (this.state === "connecting") this.state = "listening"; }
    else if (event.kind === "closed") { this.state = "completed"; }
    else if (event.itemId && typeof event.text === "string") {
      const item = this.items.get(event.itemId) ?? { text: "", completed: false };
      if (item.completed) return;
      item.text = event.kind === "completed" ? event.text : item.text + event.text;
      item.completed = event.kind === "completed";
      this.items.set(event.itemId, item);
      const current = Array.from(this.items.values()).map((value) => value.text).join("\n");
      this.text = this.prefix ? this.prefix + "\n\n[Live preview gap]\n\n" + current : current;
      if (this.text.length * 2 > MAX_TEXT) {
        this.text = this.text.slice(0, MAX_TEXT / 2);
        this.items.clear(); this.prefix = "";
        this.fail("live_response_too_large", generation); return;
      }
      if (this.firstVisibleMs === null && current.trim() && this.captureStartedAt !== null) {
        this.firstVisibleMs = Math.max(0, this.now() - this.captureStartedAt);
      }
    }
    this.changed();
  }
}
