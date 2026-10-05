import assert from "node:assert/strict";
import test from "node:test";
import { ShortcutBinding, ScopedShortcut, shortcutFromKey } from "../src/shortcuts.ts";
import { TranscriptionSession } from "../src/transcriptionSession.ts";
import { PcmRecorder } from "../src/audioCapture.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const key = changes => ({ code: "KeyA", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false, ...changes });

test("shortcut capture accepts modified physical keys and rejects accidental or cancellation keys", () => {
  assert.equal(shortcutFromKey(key({ code: "KeyZ", altKey: true, shiftKey: true })), "Ctrl+Alt+Shift+Z");
  assert.equal(shortcutFromKey(key({ code: "F8", ctrlKey: false, metaKey: true })), "Super+F8");
  for (const change of [{ code: "Escape" }, { code: "ControlLeft" }, { repeat: true }, { ctrlKey: false }, { code: "Backquote" }]) {
    assert.equal(shortcutFromKey(key(change)), null);
  }
});

test("shortcut conflicts and failed old unregistration preserve working binding", async () => {
  const shortcuts = new Set();
  let rejectRemoval = false;
  const binding = new ShortcutBinding(async shortcut => {
    if (shortcut === "Ctrl+Q") throw Error("Conflict");
    shortcuts.add(shortcut);
  }, async shortcut => {
    if (rejectRemoval && shortcut === "Ctrl+A") throw Error("Unavailable");
    shortcuts.delete(shortcut);
  });
  await binding.apply("Ctrl+A");
  await assert.rejects(binding.apply("Ctrl+Q"));
  assert.equal(binding.active, "Ctrl+A");
  rejectRemoval = true;
  await assert.rejects(binding.apply("Ctrl+B"));
  assert.deepEqual([...shortcuts], ["Ctrl+A"]);
  assert.equal(binding.active, "Ctrl+A");
  rejectRemoval = false;
  await binding.apply("Ctrl+B");
  assert.deepEqual([...shortcuts], ["Ctrl+B"]);
});

test("Escape is released when session cancels while global registration is pending", async () => {
  const pending = deferred(), actions = [];
  const scope = new ScopedShortcut(async () => { actions.push("register"); await pending.promise; },
    async () => { actions.push("unregister"); }, () => {});
  const registering = scope.setActive(true);
  scope.setActive(false);
  pending.resolve();
  await registering;
  assert.deepEqual(actions, ["register", "unregister"]);
});

test("shortcut recording suspends the old binding and restores it on cancellation or conflict", async () => {
  const shortcuts = new Set();
  const binding = new ShortcutBinding(async shortcut => {
    if (shortcut === "Alt+B") throw Error("Conflict");
    shortcuts.add(shortcut);
  }, async shortcut => { shortcuts.delete(shortcut); });
  await binding.apply("Ctrl+A");
  await binding.suspend();
  assert.equal(binding.available, false);
  assert.equal(shortcuts.size, 0);
  await binding.resume();
  assert.equal(binding.available, true);
  await binding.suspend();
  await assert.rejects(binding.apply("Alt+B"));
  assert.deepEqual([...shortcuts], ["Ctrl+A"]);
  assert.equal(binding.active, "Ctrl+A");
  assert.equal(binding.available, true);
  await binding.suspend();
  await binding.apply("Ctrl+A");
  assert.equal(binding.available, true);
});

test("Escape registration conflict reports unavailable and does not capture idle keys", async () => {
  const available = [];
  let attempts = 0;
  const scope = new ScopedShortcut(async () => { attempts++; throw Error("Conflict"); },
    async () => assert.fail("No Escape was registered"), value => available.push(value));
  await scope.setActive(true);
  await scope.setActive(false);
  assert.equal(attempts, 1);
  assert.deepEqual(available, [false]);
});

test("successful consecutive dictations retain original words until each explicit discard", async () => {
  let attempt = 0;
  const session = new TranscriptionSession(async () => `original ${++attempt}`, () => {}, () => {}, {
    capture: async () => {}, discard: async () => {},
    insert: async () => ({ pasteSent: true, pasteAttempted: true, clipboardRestored: true, message: "Inserted" }),
  }, { clean: async text => `${text} cleaned` });
  for (let number = 1; number <= 3; number++) {
    session.begin(); session.capture(new Blob([new Uint8Array(48)])); await session.transcribe();
    assert.equal(session.canBeginNext, true);
    assert.equal(session.transcript, `original ${number}`);
  }
  assert.deepEqual(session.retainedResults.map(result => result.transcript), ["original 2", "original 1"]);
  assert.deepEqual(session.retainedResults.map(result => result.outputText), ["original 2 cleaned", "original 1 cleaned"]);
  session.discard();
  assert.equal(session.retainedResults.length, 2);
  session.discardRetained(session.retainedResults[0].sessionId);
  assert.equal(session.retainedResults.length, 1);
  assert.equal(session.retainedResults[0].transcript, "original 1");
});

test("failed or uncertain dictations require recovery before a new session", async () => {
  for (const outcome of ["provider", "insertion"]) {
    const session = new TranscriptionSession(async () => {
      if (outcome === "provider") throw "transcription_network_failed";
      return "original";
    }, () => {}, () => {}, {
      capture: async () => {}, discard: async () => {}, insert: async () => { throw "uncertain"; },
    });
    session.begin(); session.capture(new Blob([new Uint8Array(48)])); await session.transcribe();
    assert.equal(session.canBeginNext, false);
    assert.throws(() => session.begin());
    assert.equal(session.retainedResults.length, 0);
    assert.ok(session.audio || session.transcript);
  }
});

test("cancelled pending microphone permission never starts audio graph and stops late tracks", async () => {
  const pending = deferred();
  let stopped = 0;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => pending.promise } } });
  try {
    const recorder = new PcmRecorder(() => {}, () => {}, () => {});
    const start = recorder.start("");
    recorder.cancelStartup();
    pending.resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
    await assert.rejects(start, { name: "AbortError" });
    assert.equal(stopped, 1);
    assert.equal(recorder.isRecording, false);
    assert.equal(recorder.hasRecording, false);
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  }
});
