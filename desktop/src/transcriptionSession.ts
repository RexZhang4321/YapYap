export const MAX_AUDIO_BYTES = 25_000_000;

export type SessionState = "idle" | "recording" | "finalizing" | "ready" | "inserted" | "failed" | "discarded";
export interface InsertionResult {
  pasteAttempted: boolean;
  pasteSent: boolean;
  clipboardRestored: boolean;
  message: string;
}
export interface TextDestination {
  capture(sessionId: string): Promise<void>;
  insert(sessionId: string, text: string): Promise<InsertionResult>;
  discard(sessionId: string): Promise<void>;
}

// Owns one dictation through recovery. A request stays locked after cancellation.
export class TranscriptionSession {
  audio: Blob | null = null;
  transcript = "";
  error: string | null = null;
  busy = false;
  discarded = false;
  state: SessionState = "idle";
  sessionId = "";
  insertion: InsertionResult | null = null;
  inserting = false;
  private generation = 0;
  private targetReady: Promise<boolean> = Promise.resolve(false);
  private automaticInsertion = true;
  private readonly provider: (audio: Uint8Array) => Promise<string>;
  private readonly changed: () => void;
  private readonly releaseAudio: () => void;

  constructor(provider: (audio: Uint8Array) => Promise<string>, changed: () => void, releaseAudio: () => void,
    private readonly destination?: TextDestination) {
    this.provider = provider;
    this.changed = changed;
    this.releaseAudio = releaseAudio;
  }

  get hasResult(): boolean { return this.audio !== null || this.transcript !== ""; }
  get canStart(): boolean {
    return !this.busy && (this.state === "idle" || this.state === "discarded");
  }
  get canRetryInsertion(): boolean {
    return !this.busy && this.state === "failed" && this.transcript !== ""
      && this.insertion !== null && !this.insertion.pasteAttempted;
  }

  private async insert() {
    this.inserting = true;
    this.error = null;
    this.changed();
    try {
      this.insertion = await this.destination!.insert(this.sessionId, this.transcript);
      this.state = this.insertion.pasteSent ? "inserted" : "failed";
      if (!this.insertion.pasteSent) this.error = "insertion_failed";
    } catch {
      this.insertion = null;
      this.error = "insertion_outcome_unknown";
      this.state = "failed";
    } finally {
      this.inserting = false;
    }
  }

  async retryInsertion() {
    if (!this.canRetryInsertion || !this.destination) return;
    this.busy = true;
    try { await this.insert(); }
    finally { this.busy = false; this.changed(); }
  }

  begin(captureTarget = true) {
    if (!this.canStart) throw new Error("Resolve or discard the previous session first.");
    this.generation += 1;
    this.sessionId = crypto.randomUUID();
    this.discarded = false;
    this.error = null;
    this.insertion = null;
    this.state = "recording";
    this.automaticInsertion = captureTarget;
    // Capture before microphone startup. An unavailable destination uses Copy.
    try {
      this.targetReady = this.destination && captureTarget
        ? this.destination.capture(this.sessionId).then(() => true, () => false)
        : Promise.resolve(false);
    } catch { this.targetReady = Promise.resolve(false); }
    this.changed();
  }

  failRecording() {
    if (this.discarded) return;
    this.state = "failed";
    this.error = "transcription_audio_invalid";
    this.changed();
  }

  capture(audio: Blob) {
    if (this.busy || this.hasResult) throw new Error("Discard the previous result first.");
    if (this.state !== "recording") this.begin();
    this.audio = audio;
    this.error = null;
    this.discarded = false;
    this.state = "ready";
    this.changed();
  }

  discard(): boolean {
    // A dispatched paste cannot be undone. Wait for its result before discard.
    if (this.inserting) return false;
    this.generation += 1;
    try {
      if (this.sessionId) void this.destination?.discard(this.sessionId).catch(() => undefined);
    } catch { /* Local discard remains valid if native IPC is unavailable. */ }
    this.audio = null;
    this.transcript = "";
    this.error = null;
    this.discarded = true;
    this.state = "discarded";
    this.insertion = null;
    this.releaseAudio();
    this.changed();
    return true;
  }

  async transcribe() {
    if (this.busy || !this.audio) return;
    if (this.audio.size <= 44 || this.audio.size > MAX_AUDIO_BYTES) {
      this.error = this.audio.size > MAX_AUDIO_BYTES ? "transcription_audio_too_large" : "transcription_audio_invalid";
      this.state = "failed";
      this.changed();
      return;
    }
    const generation = this.generation;
    let audio: Blob | null = this.audio;
    this.busy = true;
    this.state = "finalizing";
    this.error = null;
    this.changed();
    try {
      let bytes: Uint8Array | null = new Uint8Array(await audio.arrayBuffer());
      audio = null;
      if (generation !== this.generation) return;
      const pending = this.provider(bytes);
      bytes = null;
      const transcript = await pending;
      if (generation !== this.generation) return;
      if (!transcript.trim()) throw "transcription_empty";
      this.transcript = transcript;
      this.audio = null;
      this.state = "ready";
      this.releaseAudio();
      this.changed();
      if (!this.destination || !this.automaticInsertion) return;
      const targetReady = await this.targetReady;
      if (generation !== this.generation) return;
      if (!targetReady) {
        this.error = "insertion_target_unavailable";
        this.state = "failed";
        return;
      }
      await this.insert();
    } catch (error: unknown) {
      if (generation === this.generation) {
        // Only known codes are translated by the view; raw errors are never shown.
        this.error = typeof error === "string" ? error : "transcription_operation_failed";
        this.state = "failed";
      }
    } finally {
      audio = null;
      this.busy = false;
      this.changed();
    }
  }
}
