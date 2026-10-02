export const MAX_AUDIO_BYTES = 25_000_000;

// A stopped recording is owned until success or explicit discard. A request in
// flight remains locked after discard, and its late result cannot restore text.
export class TranscriptionSession {
  audio: Blob | null = null;
  transcript = "";
  error: string | null = null;
  busy = false;
  discarded = false;
  private generation = 0;
  private readonly provider: (audio: Uint8Array) => Promise<string>;
  private readonly changed: () => void;
  private readonly releaseAudio: () => void;

  constructor(provider: (audio: Uint8Array) => Promise<string>, changed: () => void, releaseAudio: () => void) {
    this.provider = provider;
    this.changed = changed;
    this.releaseAudio = releaseAudio;
  }

  get hasResult(): boolean { return this.audio !== null || this.transcript !== ""; }

  capture(audio: Blob) {
    if (this.busy || this.hasResult) throw new Error("Discard the previous result first.");
    this.generation += 1;
    this.audio = audio;
    this.error = null;
    this.discarded = false;
    this.changed();
  }

  discard() {
    this.generation += 1;
    this.audio = null;
    this.transcript = "";
    this.error = null;
    this.discarded = true;
    this.releaseAudio();
    this.changed();
  }

  async transcribe() {
    if (this.busy || !this.audio) return;
    if (this.audio.size <= 44 || this.audio.size > MAX_AUDIO_BYTES) {
      this.error = this.audio.size > MAX_AUDIO_BYTES ? "transcription_audio_too_large" : "transcription_audio_invalid";
      this.changed();
      return;
    }
    const generation = this.generation;
    let audio: Blob | null = this.audio;
    this.busy = true;
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
    } catch (error: unknown) {
      if (generation === this.generation) {
        // Only known codes are translated by the view; raw errors are never shown.
        this.error = typeof error === "string" ? error : "transcription_operation_failed";
      }
    } finally {
      audio = null;
      this.busy = false;
      this.changed();
    }
  }
}
