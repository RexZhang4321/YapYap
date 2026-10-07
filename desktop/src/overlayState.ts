import type { SessionState, InsertionResult } from "./transcriptionSession";

export type OverlayPhase = "hidden" | "recording" | "processing" | "ready" | "error";
export const MAX_OVERLAY_TEXT = 2048; // UTF-16 units; show the latest portion only.
export type OverlayPreview = "off" | "connecting" | "listening" | "finishing" | "completed" | "failed";
export interface OverlayContent { phase: OverlayPhase; text: string; preview: OverlayPreview; hasGap: boolean }
export interface OverlaySnapshot extends OverlayContent { epoch: number; revision: number }
export interface OverlayLive { state: OverlayPreview | "idle" | "discarded"; text: string; hasGap: boolean }

export function overlayContent(phase: OverlayPhase, live?: OverlayLive): OverlayContent {
  if (phase === "hidden" || !live || live.state === "idle" || live.state === "discarded" || live.state === "off") {
    return { phase, text: "", preview: "off", hasGap: false };
  }
  let text = live.text.slice(-MAX_OVERLAY_TEXT);
  // Do not split an emoji at the start of the retained tail.
  if (text.length && text.charCodeAt(0) >= 0xdc00 && text.charCodeAt(0) <= 0xdfff) text = text.slice(1);
  return { phase, text, preview: live.state, hasGap: live.hasGap };
}

function sameContent(a: OverlayContent | null, b: OverlayContent | null): boolean {
  return a !== null && b !== null && a.phase === b.phase && a.text === b.text
    && a.preview === b.preview && a.hasGap === b.hasGap;
}
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
  recording: { title: "Listening", text: "Listening to your microphone…", hint: "Release the shortcut to insert" },
  processing: { title: "Finalizing", text: "Finishing your dictation…", hint: "Open YapYap from the tray to stop waiting, copy, or cancel" },
  ready: { title: "Ready", text: "Your words are available in YapYap.", hint: "Open YapYap from the tray to retry, copy, or discard" },
  error: { title: "Needs attention", text: "Open YapYap from the tray to see the issue and recover your words.", hint: "Retry, review and copy, restore your clipboard, or discard there" },
};

export function overlayPresentation(content: OverlayContent) {
  const copy = { ...overlayCopy[content.phase], label: content.preview === "off" ? "YapYap" : "Provisional", warning: false };
  if (content.phase === "hidden") return copy;
  if (content.text) copy.text = content.text;
  if (content.phase === "error") return copy;
  if (content.preview === "failed") {
    copy.warning = true;
    copy.title = content.phase === "recording" ? "Listening · preview unavailable" : copy.title;
    copy.hint = content.phase === "recording"
      ? "Recording continues. Open YapYap to reconnect the preview."
      : "Open YapYap to recover your words.";
  } else if (content.phase === "recording") {
    if (content.preview === "connecting") {
      if (!content.text) copy.text = "Connecting live preview…";
      copy.hint = "Provisional · Recording continues while connecting";
    } else if (content.preview !== "off") copy.hint = "Provisional · Release the shortcut to finish";
    else copy.hint = "Live preview is off · Release the shortcut to finish";
  } else if (content.phase === "processing" && content.preview !== "off") copy.hint = "Provisional · Open YapYap to stop waiting, review words, or cancel";
  if (content.hasGap) { copy.warning = true; copy.hint = "Preview has a gap · " + copy.hint; }
  return copy;
}

// Reject stale events, including a delayed snapshot fetched during startup.
export class OverlayReceiver {
  private epoch = -1;
  private revision = -1;
  accept(snapshot: OverlaySnapshot): boolean {
    if (!Number.isSafeInteger(snapshot.epoch) || !Number.isSafeInteger(snapshot.revision)
      || snapshot.epoch < 0 || snapshot.revision < 0 || snapshot.epoch < this.epoch
      || (snapshot.epoch === this.epoch && snapshot.revision <= this.revision)
      || !Object.prototype.hasOwnProperty.call(overlayCopy, snapshot.phase)
      || !["off", "connecting", "listening", "finishing", "completed", "failed"].includes(snapshot.preview)
      || typeof snapshot.text !== "string" || snapshot.text.length > MAX_OVERLAY_TEXT
      || typeof snapshot.hasGap !== "boolean"
      || ((snapshot.phase === "hidden" || snapshot.preview === "off") && (snapshot.text !== "" || snapshot.hasGap))
      || (snapshot.phase === "hidden" && snapshot.preview !== "off")) return false;
    this.epoch = snapshot.epoch;
    this.revision = snapshot.revision;
    return true;
  }
}

// Serialize native work and coalesce pending changes. A slow show can never run
// after a later hide, and a failed overlay must not reject the dictation flow.
export class OverlayController {
  private pending: OverlayContent | null = null;
  private running = false;
  private delivered: OverlayContent | null = null;
  private revision = 0;
  private epoch = 0;
  private initialized = false;

  constructor(private readonly snapshot: () => Promise<OverlaySnapshot>,
    private readonly send: (snapshot: OverlaySnapshot) => Promise<void>,
    private readonly report: (failed: boolean) => void) {}

  update(phase: OverlayPhase, live?: OverlayLive) {
    this.pending = overlayContent(phase, live);
    if (!this.running) void this.flush();
  }

  private async flush() {
    this.running = true;
    let sending: OverlayContent | null = null;
    try {
      if (!this.initialized) {
        const owner = await this.snapshot();
        this.revision = owner.revision;
        this.epoch = owner.epoch;
        this.initialized = true;
      }
      while (this.pending !== null) {
        const content = this.pending;
        this.pending = null;
        if (sameContent(content, this.delivered)) continue;
        sending = content;
        await this.send({ epoch: this.epoch, revision: ++this.revision, ...content });
        this.delivered = content;
        this.report(false);
      }
    } catch {
      // Preserve a newer state (especially discard/hide) if the previous native
      // operation failed. Retry it once, without looping on the failed phase.
      if (sameContent(this.pending, sending) || sending === null) this.pending = null;
      this.delivered = null;
      this.report(true);
    } finally {
      this.running = false;
      if (this.pending !== null) void this.flush();
    }
  }
}
