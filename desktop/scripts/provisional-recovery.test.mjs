import assert from "node:assert/strict";
import test from "node:test";
import { selectProvisionalText } from "../src/provisionalRecovery.ts";

const recovery = (changes = {}) => ({
  sessionId: "current", previewSessionId: "current", sessionState: "failed", discarded: false,
  held: false, operationBusy: false, busy: false, inserting: false,
  liveState: "completed", text: "  你好 😀\nuser_id 12.50\n[Live preview gap]\n https://example.com  ",
  ...changes,
});

test("explicit recovery keeps exact provisional snapshot after final failure including unfinished live updates", () => {
  for (const sessionState of ["ready", "failed", "inserted"]) {
    for (const liveState of ["connecting", "listening", "finishing", "completed", "failed"]) {
      const snapshot = recovery({ sessionState, liveState });
      assert.equal(selectProvisionalText(snapshot), snapshot.text);
      // Selection has no side effect on either source or session classification.
      assert.equal(snapshot.sessionState, sessionState);
      assert.equal(snapshot.liveState, liveState);
    }
  }
});

test("old or missing preview ownership cannot recover words into the current session", () => {
  for (const changes of [
    { sessionId: "" }, { previewSessionId: "" }, { sessionId: "new", previewSessionId: "old" },
    { sessionId: "old", previewSessionId: "new" }, { discarded: true },
  ]) assert.equal(selectProvisionalText(recovery(changes)), null);
});

test("every recording, request, clipboard, and paste lock prevents provisional Copy", () => {
  for (const field of ["held", "operationBusy", "busy", "inserting"]) {
    assert.equal(selectProvisionalText(recovery({ [field]: true })), null);
  }
  for (const sessionState of ["idle", "recording", "finalizing", "discarded", "unknown"]) {
    assert.equal(selectProvisionalText(recovery({ sessionState })), null);
  }
});

test("empty or cleared live previews are unavailable and a later snapshot is selected independently", () => {
  for (const text of ["", "  \t\n"]) assert.equal(selectProvisionalText(recovery({ text })), null);
  for (const liveState of ["idle", "discarded", "unknown"]) {
    assert.equal(selectProvisionalText(recovery({ liveState })), null);
  }
  const snapshot = recovery({ liveState: "finishing", text: "First unfinished words" });
  const first = selectProvisionalText(snapshot);
  snapshot.text = "Later provisional words";
  assert.equal(first, "First unfinished words");
  assert.equal(selectProvisionalText(snapshot), "Later provisional words");
});
