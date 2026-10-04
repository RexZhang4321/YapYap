export interface ProvisionalRecoverySnapshot {
  sessionId: string;
  previewSessionId: string;
  sessionState: string;
  discarded: boolean;
  held: boolean;
  operationBusy: boolean;
  busy: boolean;
  inserting: boolean;
  liveState: string;
  text: string;
}

// Recovery is an explicit copy from a settled, current dictation session.
// A prior session's preview can never become a new session's fallback text.
export function selectProvisionalText(snapshot: ProvisionalRecoverySnapshot): string | null {
  if (!snapshot.sessionId || snapshot.previewSessionId !== snapshot.sessionId
    || snapshot.discarded || snapshot.held || snapshot.operationBusy || snapshot.busy || snapshot.inserting
    || !["ready", "failed", "inserted"].includes(snapshot.sessionState)
    || !["connecting", "listening", "finishing", "completed", "failed"].includes(snapshot.liveState)
    || !snapshot.text.trim()) return null;
  return snapshot.text;
}
