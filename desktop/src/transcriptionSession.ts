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
export interface CleanupModel {
  clean(text: string): Promise<string>;
}

// IPC is a runtime boundary: never trust its declared return type alone.
function validCleanup(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0
    && new TextEncoder().encode(text).byteLength <= 65_536
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text);
}

// Owns one dictation through recovery. A request stays locked after cancellation.
export class TranscriptionSession {
  audio: Blob | null = null;
  transcript = "";
  cleanedTranscript: string | null = null;
  cleanupWarning: "cleanup_failed" | null = null;
  cleaning = false;
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
  private cleanupEnabled = false;
  private readonly provider: (audio: Uint8Array) => Promise<string>;
  private readonly changed: () => void;
  private readonly releaseAudio: () => void;

  constructor(provider: (audio: Uint8Array) => Promise<string>, changed: () => void, releaseAudio: () => void,
    private readonly destination?: TextDestination, private readonly cleanup?: CleanupModel) {
    this.provider = provider;
    this.changed = changed;
    this.releaseAudio = releaseAudio;
  }

  get hasResult(): boolean { return this.audio !== null || this.transcript !== ""; }
  get outputText(): string { return this.cleanedTranscript ?? this.transcript; }
  get usesCleanup(): boolean { return this.cleanupEnabled; }
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
      this.insertion = await this.destination!.insert(this.sessionId, this.outputText);
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

  begin(captureTarget = true, cleanupEnabled = true) {
    if (!this.canStart) throw new Error("Resolve or discard the previous session first.");
    this.generation += 1;
    this.sessionId = crypto.randomUUID();
    this.discarded = false;
    this.error = null;
    this.cleanedTranscript = null;
    this.cleanupWarning = null;
    this.insertion = null;
    this.state = "recording";
    this.automaticInsertion = captureTarget;
    this.cleanupEnabled = cleanupEnabled && this.cleanup !== undefined;
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
    this.cleanedTranscript = null;
    this.cleanupWarning = null;
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
      this.releaseAudio();
      this.changed();
      if (this.cleanupEnabled && this.cleanup) {
        this.cleaning = true;
        this.changed();
        try {
          const cleaned = await this.cleanup.clean(transcript);
          if (generation !== this.generation) return;
          if (!validCleanup(cleaned)) throw new Error("Invalid cleanup result");
          this.cleanedTranscript = cleaned.trim();
        } catch {
          if (generation !== this.generation) return;
          // Cleanup is optional. Failure must not block insertion or expose raw errors.
          this.cleanupWarning = "cleanup_failed";
        } finally {
          this.cleaning = false;
        }
      }
      if (generation !== this.generation) return;
      this.state = "ready";
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
      this.cleaning = false;
      this.busy = false;
      this.changed();
    }
  }
}
