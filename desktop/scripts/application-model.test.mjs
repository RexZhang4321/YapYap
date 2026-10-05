import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationModel, parsePreferences } from "../src/applicationModel.ts";
import { TranscriptionSession } from "../src/transcriptionSession.ts";
import { LiveTranscription } from "../src/liveTranscription.ts";
import { createUiStore } from "../src/ui/store.ts";

test("existing preferences load without persisting readiness, recovery, or unknown data", () => {
  const model = new ApplicationModel();
  model.loadPreferences(JSON.stringify({ shortcut: "Alt+F9", microphone: "chosen-device", cleanup: false,
    live: false, transcript: "private text", key: "private key" }));
  model.setKeyState({ state: "saved", busy: false });
  model.updateRecovery({ livePreviewSession: "session-id", captureInterruptionMessage: "device issue" });
  assert.deepEqual(JSON.parse(model.serializePreferences()), {
    shortcut: "Alt+F9", microphone: "chosen-device", cleanup: false, live: false,
  });
  assert.equal(model.readiness.selectedMicrophone, "chosen-device");
  assert.equal(model.interaction.shortcutDraft, "Alt+F9");
  for (const invalid of [null, "not json", "[]", "null", "42"]) {
    assert.deepEqual(parsePreferences(invalid), { shortcut: "Ctrl+Alt+F8", microphone: "", cleanup: true, live: true });
  }
  assert.equal(parsePreferences('{"cleanup":false,"live":"false","microphone":42}').cleanup, false);
  assert.equal(parsePreferences('{"live":"false"}').live, true);
});

test("UI control changes alone cannot change the configuration consumed by dictation", () => {
  const model = new ApplicationModel();
  const ui = createUiStore(model);
  ui.control("cleanup-enabled").checked = false;
  ui.control("live-enabled").checked = false;
  ui.control("microphone").value = "presentation-only";
  ui.control("hotkey-action").value = "insert";
  assert.equal(model.preferences.cleanup, true);
  assert.equal(model.preferences.live, true);
  assert.equal(model.readiness.selectedMicrophone, "");
  assert.equal(model.interaction.testMode, "record");
  model.setPreferences({ cleanup: false, microphone: "preferred" });
  model.updateReadiness({ selectedMicrophone: "" }); // Preferred device is disconnected.
  assert.equal(JSON.parse(model.serializePreferences()).microphone, "preferred");
});

test("application snapshots cannot be mutated and older snapshots remain unchanged", () => {
  const model = new ApplicationModel();
  const old = { preferences: model.preferences, readiness: model.readiness,
    interaction: model.interaction, recovery: model.recovery };
  assert.throws(() => { model.preferences.cleanup = false; }, TypeError);
  assert.throws(() => { model.readiness.key.state = "saved"; }, TypeError);
  model.setPreferences({ cleanup: false });
  model.updateReadiness({ microphoneAccess: "ready" });
  model.updateInteraction({ held: true, heldAction: "record" });
  model.updateRecovery({ clipboardBackupAvailable: true });
  assert.equal(old.preferences.cleanup, true);
  assert.equal(old.readiness.microphoneAccess, "unknown");
  assert.equal(old.interaction.held, false);
  assert.equal(old.recovery.clipboardBackupAvailable, false);
});

test("key readiness has one source and view subscriptions observe model changes", async () => {
  const model = new ApplicationModel();
  const ui = createUiStore(model);
  const keys = [];
  let notifications = 0;
  const offKey = model.onKeyState(key => keys.push(key));
  const offUi = ui.subscribe(() => notifications++);
  model.setKeyState({ state: "saved", busy: false });
  model.updateReadiness({ microphoneAccess: "ready" });
  assert.equal(ui.keyState(), model.readiness.key);
  assert.equal(model.isReady(true), true);
  assert.equal(model.isReady(false), false);
  await Promise.resolve();
  assert.equal(notifications, 1);
  assert.deepEqual(keys.map(key => key.state), ["unknown", "saved"]);
  offKey(); offUi();
  model.setKeyState({ state: "missing", busy: false });
  await Promise.resolve();
  assert.equal(keys.length, 2);
  assert.equal(notifications, 1);
});

test("active and clipboard availability follow the session owner through processing and cancellation", async () => {
  const model = new ApplicationModel();
  const ui = createUiStore(model);
  const session = new TranscriptionSession(() => new Promise(() => {}), () => model.publish(), () => {});
  const preview = new LiveTranscription({}, () => {});
  model.connectSession(session, preview);
  model.updateRecovery({ clipboardBackupAvailable: true });
  assert.equal(model.canRestoreClipboard, true);
  model.updateInteraction({ held: true, heldAction: "record" });
  assert.equal(ui.active(), true);
  session.begin(false);
  session.capture(new Blob([new Uint8Array(128)]));
  const pending = session.transcribe();
  model.updateInteraction({ held: false, heldAction: null });
  assert.equal(ui.active(), true); // Release does not unlock ongoing finalization.
  assert.equal(model.canRestoreClipboard, false);
  session.discard();
  await pending;
  assert.equal(ui.active(), false);
  assert.equal(model.canRestoreClipboard, true);
  assert.equal(model.session, session);
  assert.equal(model.preview, preview);
});

test("operation generations isolate late work without changing preferences or recovery", () => {
  const model = new ApplicationModel();
  model.updateRecovery({ livePreviewSession: "current" });
  const oldOperation = model.nextOperation();
  model.nextOperation();
  assert.notEqual(oldOperation, model.operation);
  assert.equal(model.recovery.livePreviewSession, "current");
  assert.equal(model.preferences.shortcut, "Ctrl+Alt+F8");
});
