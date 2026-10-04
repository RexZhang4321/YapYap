import type { SessionState, InsertionResult } from "./transcriptionSession";

export type OverlayPhase = "hidden" | "recording" | "processing" | "ready" | "error";
export interface OverlaySnapshot { epoch: number; revision: number; phase: OverlayPhase }
export interface OverlaySession {
  state: SessionState;
  busy: boolean;
  inserting: boolean;
  error: string | null;
  insertion: InsertionResult | null;
  interrupted: boolean;
  stopping: boolean;
}

export function overlayPhase(session: OverlaySession): OverlayPhase {
  if (session.state === "idle" || session.state === "discarded") return "hidden";
  if (session.state === "inserted") return session.insertion?.clipboardRestored && !session.error ? "hidden" : "error";
  if (session.error || session.interrupted || (session.insertion?.pasteSent && !session.insertion.clipboardRestored)) return "error";
  if (session.busy || session.inserting || session.stopping) return "processing";
  if (session.state === "recording") return "recording";
  return session.state === "failed" ? "error" : "ready";
}

export const overlayCopy: Record<OverlayPhase, { title: string; text: string; hint: string }> = {
  hidden: { title: "Ready to dictate", text: "", hint: "" },
  recording: { title: "Listening", text: "Your words will appear here.", hint: "Placeholder preview · Release the shortcut to finish" },
  processing: { title: "Processing", text: "Finishing your dictation…", hint: "Keep your destination active" },
  ready: { title: "Ready", text: "Your recording or transcript is retained.", hint: "Open the probe from the tray to transcribe, copy, or discard" },
  error: { title: "Needs attention", text: "Open the probe from the tray to recover or discard.", hint: "Available audio and text stay in memory until discard or quit" },
};

// Serialize native work and coalesce pending changes. A slow show can never run
// after a later hide, and a failed overlay must not reject the dictation flow.
export class OverlayController {
  private pending: OverlayPhase | null = null;
  private running = false;
  private delivered: OverlayPhase | null = null;
  private revision = 0;
  private epoch = 0;
  private initialized = false;

  constructor(private readonly snapshot: () => Promise<OverlaySnapshot>,
    private readonly send: (snapshot: OverlaySnapshot) => Promise<void>,
    private readonly report: (failed: boolean) => void) {}

  update(phase: OverlayPhase) {
    this.pending = phase;
    if (!this.running) void this.flush();
  }

  private async flush() {
    this.running = true;
    let sending: OverlayPhase | null = null;
    try {
      if (!this.initialized) {
        const owner = await this.snapshot();
        this.revision = owner.revision;
        this.epoch = owner.epoch;
        this.initialized = true;
      }
      while (this.pending !== null) {
        const phase = this.pending;
        this.pending = null;
        if (phase === this.delivered) continue;
        sending = phase;
        await this.send({ epoch: this.epoch, revision: ++this.revision, phase });
        this.delivered = phase;
        this.report(false);
      }
    } catch {
      // Preserve a newer state (especially discard/hide) if the previous native
      // operation failed. Retry it once, without looping on the failed phase.
      if (this.pending === sending || sending === null) this.pending = null;
      this.delivered = null;
      this.report(true);
    } finally {
      this.running = false;
      if (this.pending !== null) void this.flush();
    }
  }
}
