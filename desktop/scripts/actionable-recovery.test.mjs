import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptionSession } from "../src/transcriptionSession.ts";
import { confirmRecoveryCopy } from "../src/recoveryCopy.ts";
import { selectProvisionalText } from "../src/provisionalRecovery.ts";
import { PcmRecorder } from "../src/audioCapture.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const forever = () => new Promise(() => {});
const audio = () => new Blob([new Uint8Array(48)]);
const paste = { pasteAttempted: true, pasteSent: true, clipboardRestored: true, message: "fixture" };
const shortTiming = { stalledMs: 5, transcriptionMs: 35, cleanupMs: 20, targetMs: 20, insertionMs: 20 };

test("discard settles never-resolving final/cleanup requests immediately and permits another session", async () => {
  for (const stage of ["final", "cleanup"]) {
    const entered = deferred();
    const session = new TranscriptionSession(() => {
      if (stage === "final") { entered.resolve(); return forever(); }
      return Promise.resolve("canonical original");
    }, () => {}, () => {}, undefined, { clean: () => { entered.resolve(); return forever(); } });
    session.begin(false); session.capture(audio());
    const request = session.transcribe(); await entered.promise;
    assert.equal(session.discard(), true);
    assert.equal(session.busy, false); assert.equal(session.canStart, true);
    session.begin(false); const newId = session.sessionId;
    await request;
    assert.equal(session.sessionId, newId); assert.equal(session.state, "recording");
    assert.equal(session.busy, false); assert.equal(session.transcript, "");
  }
});

test("late old provider results and finalizers cannot unlock or change a new pending request", async () => {
  for (const stage of ["final", "cleanup"]) {
    for (const succeeds of [true, false]) {
      const first = deferred(), second = deferred(); let calls = 0;
      const session = new TranscriptionSession(() => stage === "final"
        ? (++calls === 1 ? first.promise : second.promise) : Promise.resolve("canonical"), () => {}, () => {},
      undefined, { clean: () => ++calls === 1 ? first.promise : second.promise });
      session.begin(false); session.capture(audio()); const oldRequest = session.transcribe(); await tick();
      session.discard(); session.begin(false); session.capture(audio());
      const currentRequest = session.transcribe(); await tick();
      const currentId = session.sessionId;
      if (succeeds) first.resolve("old text"); else first.reject("old failure");
      await oldRequest; await tick();
      assert.equal(session.sessionId, currentId); assert.equal(session.busy, true);
      assert.equal(session.cleaning, stage === "cleanup"); assert.equal(session.error, null);
      assert.equal(session.transcript, stage === "cleanup" ? "canonical" : "");
      second.resolve(stage === "cleanup" ? "Canonical." : "new text");
      await currentRequest;
      assert.equal(session.outputText, stage === "cleanup" ? "Canonical." : "new text");
      assert.equal(session.busy, false);
    }
  }
});

test("rejecting recovery confirmation or confirming a replaced session has no side effects", async () => {
  const choice = { sessionId: "one", text: "  Exact words\n你好 😀  ", source: "provisional", stopWaiting: true };
  for (const accepted of [false, true]) {
    let stops = 0, copies = 0;
    const copied = await confirmRecoveryCopy(choice, {
      confirm: async shown => { assert.equal(shown.text, choice.text); return accepted; },
      isCurrent: () => !accepted,
      stopWaiting: () => { stops++; return true; }, copy: async () => { copies++; },
    });
    assert.equal(copied, false); assert.equal(stops, 0); assert.equal(copies, 0);
  }
});

test("confirmed cleanup bypass immediately copies the exact original without inserting or accepting late cleanup", async () => {
  const cleanup = deferred(), entered = deferred(); const inserted = [], copied = [];
  const original = "  um hello\n你好 user_id 42 😀  ";
  const session = new TranscriptionSession(async () => original, () => {}, () => {}, {
    capture: async () => {}, discard: async () => {}, insert: async (_, text) => { inserted.push(text); return paste; },
  }, { clean: () => { entered.resolve(); return cleanup.promise; } });
  session.begin(); session.capture(audio()); const request = session.transcribe(); await entered.promise;
  const choice = { sessionId: session.sessionId, text: session.transcript, source: "original", stopWaiting: true };
  assert.equal(await confirmRecoveryCopy(choice, { confirm: async () => true,
    isCurrent: item => item.sessionId === session.sessionId, stopWaiting: () => session.stopWaiting(),
    copy: async text => copied.push(text) }), true);
  await request;
  assert.deepEqual(copied, [original]); assert.deepEqual(inserted, []);
  assert.equal(session.outputText, original); assert.equal(session.busy, false);
  assert.equal(session.canBeginNext, true); assert.equal(session.cleanedTranscript, null);
  cleanup.resolve("Late cleanup"); await tick();
  assert.equal(session.outputText, original); assert.deepEqual(inserted, []);
});

test("confirmed provisional bypass retains full retry audio and never promotes live words to canonical text", async () => {
  const entered = deferred(), copied = []; let finalCalls = 0, inserts = 0;
  const session = new TranscriptionSession(() => {
    if (++finalCalls === 1) { entered.resolve(); return forever(); }
    return Promise.resolve("accurate final words");
  }, () => {}, () => {}, { capture: async () => {}, discard: async () => {}, insert: async () => { inserts++; return paste; } });
  session.begin(); const recording = audio(); session.capture(recording);
  const request = session.transcribe(); await entered.promise;
  const text = selectProvisionalText({ sessionId: session.sessionId, previewSessionId: session.sessionId,
    sessionState: session.state, discarded: false, held: false, operationBusy: false, busy: true,
    inserting: false, liveState: "finishing", text: "incomplete draft", allowProcessing: true });
  await confirmRecoveryCopy({ sessionId: session.sessionId, text, source: "provisional", stopWaiting: true }, {
    confirm: async () => true, isCurrent: () => true, stopWaiting: () => session.stopWaiting(),
    copy: async words => copied.push(words),
  });
  await request;
  assert.deepEqual(copied, ["incomplete draft"]); assert.equal(session.transcript, "");
  assert.equal(session.audio, recording); assert.equal(session.busy, false); assert.equal(inserts, 0);
  await session.transcribe();
  assert.equal(session.transcript, "accurate final words"); assert.equal(inserts, 0);
});

test("finite deadlines retain retry audio, fall back from cleanup, and treat stuck paste as uncertain", async () => {
  for (const stage of ["final", "cleanup", "target", "insert"]) {
    let inserted = 0, stalled = false, session;
    session = new TranscriptionSession(() => stage === "final" ? forever() : Promise.resolve("original"),
      () => { stalled ||= session.stalled; }, () => {}, {
        capture: () => stage === "target" ? forever() : Promise.resolve(), discard: async () => {},
        insert: async (_, text) => { inserted++; assert.equal(text, "original"); return stage === "insert" ? forever() : paste; },
      }, { clean: () => stage === "cleanup" ? forever() : Promise.resolve("original") }, shortTiming);
    session.begin(true, stage === "cleanup"); const original = audio(); session.capture(original);
    await session.transcribe();
    assert.equal(stalled, true); assert.equal(session.busy, false); assert.equal(session.inserting, false);
    assert.equal(session.stalled, false);
    if (stage === "final") { assert.equal(session.audio, original); assert.equal(session.error, "validation_timeout"); }
    if (stage === "cleanup") { assert.equal(session.cleanupWarning, "cleanup_failed"); assert.equal(session.state, "inserted"); assert.equal(inserted, 1); }
    if (stage === "target") { assert.equal(session.transcript, "original"); assert.equal(session.error, "insertion_target_unavailable"); assert.equal(inserted, 0); }
    if (stage === "insert") { assert.equal(session.error, "insertion_outcome_unknown"); assert.equal(session.canRetryInsertion, false); assert.equal(session.transcript, "original"); }
    assert.equal(session.discard(), true); assert.equal(session.canStart, true);
  }
});

test("late cancelled microphone startup cannot clear a newer startup lock", async () => {
  const first = deferred(), second = deferred(); let calls = 0, stopped = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: () => ++calls === 1 ? first.promise : second.promise },
  } });
  try {
    const recorder = new PcmRecorder(() => {}, () => {}, () => {});
    const oldStart = recorder.start(""); recorder.cancelStartup(); const newStart = recorder.start("");
    first.resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
    await assert.rejects(oldStart, { name: "AbortError" });
    await assert.rejects(recorder.start(""), /startup is still finishing/);
    recorder.cancelStartup(); second.resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
    await assert.rejects(newStart, { name: "AbortError" }); assert.equal(stopped, 2);
    assert.equal(recorder.isRecording, false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous); else delete globalThis.navigator;
  }
});

test("cancel during the released worklet drain keeps graph ownership until bounded stop completes", async () => {
  const recorder = new PcmRecorder(() => {}, () => {}, () => {});
  let disconnected = 0, closed = 0;
  recorder.active = true;
  recorder.sampleRate = 48_000;
  recorder.chunks = [new Float32Array([0.1, 0.2])]; recorder.frameCount = 2;
  recorder.processor = { port: { postMessage: () => {}, close: () => { closed++; } },
    disconnect: () => { disconnected++; } };
  const stopped = recorder.stop();
  assert.equal(recorder.isRecording, false); assert.equal(recorder.isStopping, true);
  assert.equal(recorder.stop(), stopped);
  recorder.cancelStartup();
  assert.throws(() => recorder.clear(), /Wait for microphone capture/);
  await assert.rejects(recorder.start(""), /capture is still stopping/);
  // Deliver the normal flush acknowledgement; the production path also has
  // a finite fallback when the worklet never acknowledges it.
  recorder.pendingFlush();
  await stopped;
  assert.equal(recorder.isStopping, false); assert.equal(recorder.hasRecording, true);
  recorder.clear();
  assert.equal(recorder.hasRecording, false); assert.equal(recorder.frameCount, 0);
  assert.equal(disconnected, 1); assert.equal(closed, 1);
  await tick(); assert.equal(recorder.hasRecording, false);
});
