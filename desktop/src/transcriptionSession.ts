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
export interface RetainedResult {
  sessionId: string;
  transcript: string;
  outputText: string;
}
export interface SessionTiming {
  stalledMs: number;
  transcriptionMs: number;
  cleanupMs: number;
  targetMs: number;
  insertionMs: number;
}
const defaultTiming: SessionTiming = {
  stalledMs: 12_000, transcriptionMs: 100_000, cleanupMs: 30_000, targetMs: 5_000, insertionMs: 15_000,
};

// IPC is a runtime boundary: never trust its declared return type alone.
function validCleanup(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0
    && new TextEncoder().encode(text).byteLength <= 65_536
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text);
}

// Cancellation releases the local session immediately. Native responses can
// arrive later, but every await and finalizer belongs to one generation.
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
  stalled = false;
  // Session-only recovery, deliberately never persisted as history.
  readonly retainedResults: RetainedResult[] = [];
  private generation = 0;
  private targetReady: Promise<boolean> = Promise.resolve(false);
  private automaticInsertion = true;
  private cleanupEnabled = false;
  private readonly pendingWaits = new Set<() => void>();
  private readonly provider: (audio: Uint8Array) => Promise<string>;
  private readonly changed: () => void;
  private readonly releaseAudio: () => void;

  constructor(provider: (audio: Uint8Array) => Promise<string>, changed: () => void, releaseAudio: () => void,
    private readonly destination?: TextDestination, private readonly cleanup?: CleanupModel,
    private readonly timing: SessionTiming = defaultTiming) {
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
  get canBeginNext(): boolean {
    return !this.busy && !this.inserting && this.transcript !== ""
      && (this.state === "inserted" || (this.state === "ready" && !this.automaticInsertion));
  }
  discardRetained(sessionId: string) {
    const index = this.retainedResults.findIndex(result => result.sessionId === sessionId);
    if (index < 0) return;
    this.retainedResults.splice(index, 1);
    this.changed();
  }
  get canRetryInsertion(): boolean {
    return !this.busy && this.state === "failed" && this.transcript !== ""
      && this.insertion !== null && !this.insertion.pasteAttempted;
  }

  private invalidate() {
    this.generation += 1;
    for (const cancel of [...this.pendingWaits]) cancel();
    this.busy = false;
    this.cleaning = false;
    this.inserting = false;
    this.stalled = false;
  }

  private async waitFor<T>(pending: Promise<T>, generation: number, timeoutMs: number, code: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stalled: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      cancel = () => reject("session_cancelled");
      this.pendingWaits.add(cancel);
      timeout = setTimeout(() => reject(code), timeoutMs);
      stalled = setTimeout(() => {
        if (generation === this.generation) { this.stalled = true; this.changed(); }
      }, this.timing.stalledMs);
    });
    try { return await Promise.race([pending, interrupted]); }
    finally {
      clearTimeout(timeout); clearTimeout(stalled);
      this.pendingWaits.delete(cancel);
      if (generation === this.generation) this.stalled = false;
    }
  }

  // Stop finalization without discarding available originals. All recovery is
  // manual Copy: opening the app can have changed the foreground destination.
  stopWaiting(): boolean {
    if (!this.busy || this.inserting) return false;
    this.invalidate();
    this.automaticInsertion = false;
    this.state = this.transcript ? "ready" : "failed";
    this.error = this.transcript ? null : "transcription_stopped";
    if (this.transcript && this.usesCleanup && !this.cleanedTranscript) this.cleanupWarning = "cleanup_failed";
    this.changed();
    return true;
  }

  private async insert() {
    const generation = this.generation;
    const sessionId = this.sessionId;
    const text = this.outputText;
    this.inserting = true;
    this.error = null;
    this.changed();
    try {
      const insertion = await this.waitFor(this.destination!.insert(sessionId, text), generation,
        this.timing.insertionMs, "insertion_outcome_unknown");
      if (generation !== this.generation) return;
      this.insertion = insertion;
      this.state = this.insertion.pasteSent ? "inserted" : "failed";
      if (!this.insertion.pasteSent) this.error = "insertion_failed";
    } catch {
      if (generation !== this.generation) return;
      this.insertion = null;
      this.error = "insertion_outcome_unknown";
      this.state = "failed";
    } finally {
      if (generation === this.generation) this.inserting = false;
    }
  }

  async retryInsertion() {
    if (!this.canRetryInsertion || !this.destination) return;
    this.busy = true;
    const generation = this.generation;
    try { await this.insert(); }
    finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }

  begin(captureTarget = true, cleanupEnabled = true) {
    if (!this.canStart && !this.canBeginNext) throw new Error("Resolve or discard the previous session first.");
    if (this.canBeginNext) {
      this.retainedResults.unshift({ sessionId: this.sessionId, transcript: this.transcript, outputText: this.outputText });
      try { void this.destination?.discard(this.sessionId).catch(() => undefined); }
      catch { /* Only the retired native target is released; original text remains. */ }
      this.transcript = "";
    }
    this.invalidate();
    this.sessionId = crypto.randomUUID();
    this.discarded = false;
    this.error = null;
    this.cleanedTranscript = null;
    this.cleanupWarning = null;
    this.insertion = null;
    this.audio = null;
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
    this.invalidate();
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
      let bytes: Uint8Array | null = new Uint8Array(await this.waitFor(audio.arrayBuffer(), generation,
        this.timing.targetMs, "transcription_audio_invalid"));
      audio = null;
      if (generation !== this.generation) return;
      const pending = this.provider(bytes);
      bytes = null;
      const transcript = await this.waitFor(pending, generation, this.timing.transcriptionMs, "validation_timeout");
      if (generation !== this.generation) return;
      // A canonical result must remain usable by native insertion/Copy before
      // releasing the only retry audio. Provider interfaces are runtime seams.
      if (typeof transcript !== "string" || transcript.includes("\0")
        || new TextEncoder().encode(transcript).byteLength > 1024 * 1024) throw "transcription_response_invalid";
      if (!transcript.trim()) throw "transcription_empty";
      this.transcript = transcript;
      this.audio = null;
      this.releaseAudio();
      this.changed();
      if (this.cleanupEnabled && this.cleanup) {
        this.cleaning = true;
        this.changed();
        try {
          const cleaned = await this.waitFor(this.cleanup.clean(transcript), generation,
            this.timing.cleanupMs, "cleanup_timeout");
          if (generation !== this.generation) return;
          if (!validCleanup(cleaned)) throw new Error("Invalid cleanup result");
          this.cleanedTranscript = cleaned.trim();
        } catch {
          if (generation !== this.generation) return;
          // Cleanup is optional. Failure must not block insertion or expose raw errors.
          this.cleanupWarning = "cleanup_failed";
        } finally {
          if (generation === this.generation) this.cleaning = false;
        }
      }
      if (generation !== this.generation) return;
      this.state = "ready";
      this.changed();
      if (!this.destination || !this.automaticInsertion) return;
      const targetReady = await this.waitFor(this.targetReady, generation, this.timing.targetMs,
        "insertion_target_unavailable");
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
      if (generation === this.generation) {
        this.cleaning = false;
        this.busy = false;
        this.changed();
      }
    }
  }
}
