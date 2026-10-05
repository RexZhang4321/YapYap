import type { TranscriptionSession } from "./transcriptionSession.ts";
import type { LiveTranscription } from "./liveTranscription.ts";

export type KeyState = "unknown" | "saved" | "missing";
export type HotkeyAction = "record" | "live" | "insert" | "retry";
export interface Preferences {
  shortcut: string;
  microphone: string;
  cleanup: boolean;
  fullAudio: boolean;
  live: boolean;
}
export interface Readiness {
  key: Readonly<{ state: KeyState; busy: boolean }>;
  microphoneAccess: "unknown" | "ready" | "blocked";
  microphoneIssue: string;
  attemptedMicrophoneAccess: boolean;
  selectedMicrophone: string;
  escapeAvailable: boolean;
}
export interface Interaction {
  held: boolean;
  heldAction: HotkeyAction | null;
  operationBusy: boolean;
  recordingShortcut: boolean;
  shortcutBusy: boolean;
  shortcutDraft: string;
  testMode: Exclude<HotkeyAction, "retry">;
}
export interface Recovery {
  captureInterruptionMessage: string | null;
  overlayCaptureReadySession: string;
  livePreviewSession: string;
  clipboardBackupAvailable: boolean;
}

export const preferencesKey = "byok-dictation-preferences";
const defaults: Readonly<Preferences> = Object.freeze({
  shortcut: "Ctrl+Alt+F8",
  microphone: "",
  cleanup: true,
  fullAudio: true,
  live: true,
});

// Settings are the only persisted application data. Audio, text, credentials,
// operation ownership and readiness never enter this serialization boundary.
export function parsePreferences(raw: string | null): Preferences {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { ...defaults };
    const saved = value as Record<string, unknown>;
    return {
      shortcut:
        typeof saved.shortcut === "string" ? saved.shortcut : defaults.shortcut,
      microphone:
        typeof saved.microphone === "string"
          ? saved.microphone
          : defaults.microphone,
      cleanup:
        typeof saved.cleanup === "boolean" ? saved.cleanup : defaults.cleanup,
      fullAudio:
        typeof saved.fullAudio === "boolean" ? saved.fullAudio : defaults.fullAudio,
      live: typeof saved.live === "boolean" ? saved.live : defaults.live,
    };
  } catch {
    return { ...defaults };
  }
}

// Application data is independent of React, control IDs, DOM nodes and IPC.
// Session and preview keep their existing lifecycle owners; this model owns
// the state coordinating them. Published values are immutable snapshots.
export class ApplicationModel {
  private preferencesValue: Readonly<Preferences> = defaults;
  private readinessValue: Readonly<Readiness> = Object.freeze({
    key: Object.freeze({ state: "unknown", busy: true }),
    microphoneAccess: "unknown",
    microphoneIssue: "",
    attemptedMicrophoneAccess: false,
    selectedMicrophone: "",
    escapeAvailable: true,
  });
  private interactionValue: Readonly<Interaction> = Object.freeze({
    held: false,
    heldAction: null,
    operationBusy: false,
    recordingShortcut: false,
    shortcutBusy: false,
    shortcutDraft: defaults.shortcut,
    testMode: "record",
  });
  private recoveryValue: Readonly<Recovery> = Object.freeze({
    captureInterruptionMessage: null,
    overlayCaptureReadySession: "",
    livePreviewSession: "",
    clipboardBackupAvailable: false,
  });
  private operationGeneration = 0;
  private sessionValue: TranscriptionSession | null = null;
  private previewValue: LiveTranscription | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly keyListeners = new Set<(key: Readiness["key"]) => void>();

  get preferences() {
    return this.preferencesValue;
  }
  get readiness() {
    return this.readinessValue;
  }
  get interaction() {
    return this.interactionValue;
  }
  get recovery() {
    return this.recoveryValue;
  }
  get operation() {
    return this.operationGeneration;
  }
  get session() {
    return this.sessionValue;
  }
  get preview() {
    return this.previewValue;
  }
  get active() {
    return (
      this.interaction.held ||
      this.interaction.operationBusy ||
      (this.session?.busy ?? false)
    );
  }
  get canRestoreClipboard() {
    return this.recovery.clipboardBackupAvailable && !this.active;
  }
  isReady(shortcutAvailable: boolean) {
    return (
      this.readiness.key.state === "saved" &&
      this.readiness.microphoneAccess === "ready" &&
      shortcutAvailable
    );
  }

  connectSession(session: TranscriptionSession, preview: LiveTranscription) {
    this.sessionValue = session;
    this.previewValue = preview;
  }
  loadPreferences(raw: string | null) {
    this.preferencesValue = Object.freeze(parsePreferences(raw));
    this.updateInteraction({ shortcutDraft: this.preferences.shortcut });
    this.updateReadiness({ selectedMicrophone: this.preferences.microphone });
  }
  setPreferences(patch: Partial<Preferences>) {
    this.preferencesValue = Object.freeze({ ...this.preferences, ...patch });
    this.publish();
  }
  serializePreferences() {
    const { shortcut, microphone, cleanup, fullAudio, live } = this.preferences;
    return JSON.stringify({ shortcut, microphone, cleanup, fullAudio, live });
  }
  updateReadiness(patch: Partial<Omit<Readiness, "key">>) {
    this.readinessValue = Object.freeze({ ...this.readiness, ...patch });
    this.publish();
  }
  setKeyState(key: Readiness["key"]) {
    this.readinessValue = Object.freeze({
      ...this.readiness,
      key: Object.freeze({ ...key }),
    });
    this.publish();
    for (const listener of this.keyListeners) listener(this.readiness.key);
  }
  onKeyState(listener: (key: Readiness["key"]) => void) {
    this.keyListeners.add(listener);
    listener(this.readiness.key);
    return () => {
      this.keyListeners.delete(listener);
    };
  }
  updateInteraction(patch: Partial<Interaction>) {
    this.interactionValue = Object.freeze({ ...this.interaction, ...patch });
    this.publish();
  }
  updateRecovery(patch: Partial<Recovery>) {
    this.recoveryValue = Object.freeze({ ...this.recovery, ...patch });
    this.publish();
  }
  nextOperation() {
    return ++this.operationGeneration;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  // Called after an existing session owner changes, including async finalizers.
  publish() {
    for (const listener of this.listeners) listener();
  }
}

export const application = new ApplicationModel();
