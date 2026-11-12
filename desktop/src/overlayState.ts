import type { SessionState, InsertionResult } from "./transcriptionSession";
import { openApp } from "#platform";

export type OverlayPhase = "hidden" | "recording" | "processing" | "ready" | "error";
export const MAX_OVERLAY_TEXT = 2048; // UTF-16 units; show the latest portion only.
export type OverlayPreview = "off" | "connecting" | "listening" | "finishing" | "completed" | "failed";
export const MAX_OVERLAY_NOTICE = 512;
export const MAX_OVERLAY_KEY = 64;
// What the overlay can say and offer without sending the user to the app:
// a short reason, the shortcut that pastes a saved transcript, and Esc.
export interface OverlayActions { notice: string; pasteKey: string; escapeKey: boolean }
export const noOverlayActions: OverlayActions = { notice: "", pasteKey: "", escapeKey: false };
export interface OverlayContent extends OverlayActions { phase: OverlayPhase; text: string; preview: OverlayPreview; hasGap: boolean }
export interface OverlaySnapshot extends OverlayContent { epoch: number; revision: number }
export interface OverlayLive { state: OverlayPreview | "idle" | "discarded"; text: string; hasGap: boolean }

// Keep the start of a string within a UTF-16 budget without splitting an emoji.
function head(value: string, max: number): string {
  if (value.length <= max) return value;
  let text = value.slice(0, max);
  const last = text.charCodeAt(text.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
  return text;
}

export function overlayContent(phase: OverlayPhase, live?: OverlayLive, actions: OverlayActions = noOverlayActions): OverlayContent {
  const offered = phase === "hidden" ? noOverlayActions : {
    notice: head(actions.notice, MAX_OVERLAY_NOTICE),
    pasteKey: head(actions.pasteKey, MAX_OVERLAY_KEY),
    escapeKey: actions.escapeKey,
  };
  if (phase === "hidden" || !live || live.state === "idle" || live.state === "discarded" || live.state === "off") {
    return { phase, text: "", preview: "off", hasGap: false, ...offered };
  }
  let text = live.text.slice(-MAX_OVERLAY_TEXT);
  // Do not split an emoji at the start of the retained tail.
  if (text.length && text.charCodeAt(0) >= 0xdc00 && text.charCodeAt(0) <= 0xdfff) text = text.slice(1);
  return { phase, text, preview: live.state, hasGap: live.hasGap, ...offered };
}

// The first sentence of an in-app message, short enough for the overlay.
export function overlayNotice(message: string): string {
  const match = /^.*?[.!?](?=\s|$)/s.exec(message.trim());
  return (match ? match[0] : message.trim());
}

function sameContent(a: OverlayContent | null, b: OverlayContent | null): boolean {
  return a !== null && b !== null && a.phase === b.phase && a.text === b.text
    && a.preview === b.preview && a.hasGap === b.hasGap && a.notice === b.notice
    && a.pasteKey === b.pasteKey && a.escapeKey === b.escapeKey;
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
  processing: { title: "Finalizing", text: "Finishing your dictation…", hint: "Open YapYap to stop waiting, copy, or cancel" },
  ready: { title: "Ready", text: "Your words are available in YapYap.", hint: "Open YapYap to retry, copy, or discard" },
  error: { title: "Needs attention", text: "Open YapYap to see the issue and recover your words.", hint: "Retry, review and copy, restore your clipboard, or discard there" },
};

function hints(...parts: (string | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}

export function overlayPresentation(content: OverlayContent) {
  const copy = { ...overlayCopy[content.phase], label: content.preview === "off" ? "YapYap" : "Provisional", warning: false };
  const esc = (verb: string) => content.escapeKey && `Esc to ${verb}`;
  if (content.phase === "processing") copy.hint = content.escapeKey ? hints(esc("cancel"), `${openApp} to stop waiting or copy`) : `${openApp} to stop waiting, copy, or cancel`;
  if (content.phase === "ready") copy.hint = content.escapeKey ? hints(esc("discard"), `${openApp} to copy or retry`) : `${openApp} to retry, copy, or discard`;
  if (content.phase === "error") {
    // Lead with the reason and the keys that act on it; the app is the fallback.
    copy.title = content.pasteKey ? "Not pasted yet" : copy.title;
    copy.text = content.notice || content.text || `${openApp} to see the issue and recover your words.`;
    copy.hint = content.pasteKey
      ? hints(`Press ${content.pasteKey} in a text field to paste`, esc("discard"))
      : content.escapeKey ? hints(esc("discard"), `${openApp} to retry or copy`) : `${openApp} to retry, copy, or discard`;
    return copy;
  }
  if (content.phase === "hidden") return copy;
  if (content.text) copy.text = content.text;
  if (content.preview === "failed") {
    copy.warning = true;
    copy.title = content.phase === "recording" ? "Listening · preview unavailable" : copy.title;
    if (content.notice && (content.phase === "recording" || !content.text)) copy.text = content.notice;
    copy.hint = content.phase === "recording"
      ? `Recording continues. ${openApp} to reconnect the preview.`
      : hints(esc("discard"), `${openApp} to recover your words.`);
  } else if (content.phase === "recording") {
    if (content.preview === "connecting") {
      if (!content.text) copy.text = "Connecting live preview…";
      copy.hint = "Provisional · Recording continues while connecting";
    } else if (content.preview !== "off") copy.hint = "Provisional · Release the shortcut to finish";
    else copy.hint = "Live preview is off · Release the shortcut to finish";
  } else if (content.phase === "processing" && content.preview !== "off") copy.hint = hints("Provisional", esc("cancel"), content.escapeKey ? `${openApp} to stop waiting or review words` : `${openApp} to stop waiting, review words, or cancel`);
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
      || typeof snapshot.notice !== "string" || snapshot.notice.length > MAX_OVERLAY_NOTICE
      || typeof snapshot.pasteKey !== "string" || snapshot.pasteKey.length > MAX_OVERLAY_KEY
      || typeof snapshot.escapeKey !== "boolean"
      || (snapshot.phase === "hidden" && (snapshot.notice !== "" || snapshot.pasteKey !== "" || snapshot.escapeKey))
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

  update(phase: OverlayPhase, live?: OverlayLive, actions?: OverlayActions) {
    this.pending = overlayContent(phase, live, actions);
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
