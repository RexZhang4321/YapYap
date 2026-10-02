import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptionSession, MAX_AUDIO_BYTES } from "../src/transcriptionSession.ts";
import { encodeWav } from "../src/audioCapture.ts";
import { transcriptionError } from "../src/transcription.ts";

const recording = () => new Blob([new Uint8Array(48)]);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("failure keeps original audio for retry; success releases audio and preserves exact text", async () => {
  let attempts = 0, releases = 0;
  const sent = [];
  const session = new TranscriptionSession(async (bytes) => {
    sent.push(bytes);
    if (++attempts === 1) throw "validation_network_failed";
    return "你好\nMicroDuck XL330 https://example.com";
  }, () => {}, () => { releases++; });
  const audio = recording();
  session.capture(audio);
  await session.transcribe();
  assert.equal(session.audio, audio);
  assert.equal(session.error, "validation_network_failed");
  assert.equal(releases, 0);
  await session.transcribe();
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(session.audio, null);
  assert.equal(session.transcript, "你好\nMicroDuck XL330 https://example.com");
  assert.equal(releases, 1);
  assert.throws(() => session.capture(recording()));
  session.discard();
  assert.equal(session.transcript, "");
  session.capture(recording());
});

test("duplicate calls send once and discard ignores late success or failure", async () => {
  for (const succeed of [true, false]) {
    const pending = deferred();
    let calls = 0;
    const session = new TranscriptionSession(() => { calls++; return pending.promise; }, () => {}, () => {});
    session.capture(recording());
    const first = session.transcribe();
    await new Promise((resolve) => setImmediate(resolve));
    await session.transcribe();
    assert.equal(calls, 1);
    session.discard();
    assert.equal(session.audio, null);
    assert.equal(session.busy, true);
    assert.throws(() => session.capture(recording()));
    if (succeed) pending.resolve("Late text"); else pending.reject("validation_timeout");
    await first;
    assert.equal(session.transcript, "");
    assert.equal(session.error, null);
    assert.equal(session.busy, false);
  }
});

test("discard during WAV conversion prevents sending", async () => {
  const pending = deferred();
  let calls = 0;
  const session = new TranscriptionSession(async () => { calls++; return "text"; }, () => {}, () => {});
  session.capture({ size: 48, arrayBuffer: () => pending.promise });
  const request = session.transcribe();
  session.discard();
  pending.resolve(new ArrayBuffer(48));
  await request;
  assert.equal(calls, 0);
});

test("empty transcript keeps retry audio and invalid uploads never send", async () => {
  const session = new TranscriptionSession(async () => "  ", () => {}, () => {});
  session.capture(recording());
  await session.transcribe();
  assert.equal(session.error, "transcription_empty");
  assert.ok(session.audio);
  for (const size of [44, MAX_AUDIO_BYTES + 1]) {
    const invalid = new TranscriptionSession(async () => assert.fail("Invalid upload sent"), () => {}, () => {});
    invalid.capture({ size });
    await invalid.transcribe();
    assert.match(invalid.error, /transcription_audio_(invalid|too_large)/);
  }
  assert.ok(!transcriptionError("secret provider body").includes("secret"));
  assert.equal(transcriptionError("__proto__"), transcriptionError("unknown-code"));
});

test("capture WAV has valid PCM16 mono headers and exact sample data", async () => {
  const wav = encodeWav({ channelCount: 1, frameCount: 4, sampleRate: 48_000,
    samples: [Float32Array.from([-1, 0, 0.5, 1])] });
  assert.equal(wav.type, "audio/wav");
  const bytes = await wav.arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(bytes.byteLength, 52);
  assert.equal(view.getUint32(4, true), 44);
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.deepEqual([44, 46, 48, 50].map((offset) => view.getInt16(offset, true)), [-32768, 0, 16383, 32767]);
});

const sentPaste = (extra = {}) => ({ pasteAttempted: true, pasteSent: true,
  clipboardRestored: true, message: "Paste sent", ...extra });
const destination = (insert) => ({ capture: async () => {}, insert, discard: async () => {} });

test("session captures destination before recording and inserts exact canonical text once", async () => {
  const text = "你好 😀\nhttps://example.com/a?q=2\nsrc/main.ts AS5047P user_id 12.50";
  const events = [], ids = [];
  const session = new TranscriptionSession(async () => { events.push("transcribe"); return text; },
    () => {}, () => events.push("release"), {
      capture: async (id) => { events.push("target"); ids.push(id); },
      insert: async (id, actual) => { ids.push(id); assert.equal(actual, text); events.push("insert"); return sentPaste(); },
      discard: async () => {},
    });
  session.begin();
  assert.equal(session.state, "recording");
  assert.deepEqual(events, ["target"]);
  session.capture(recording());
  await session.transcribe();
  assert.equal(session.state, "inserted");
  assert.equal(session.transcript, text);
  assert.equal(ids[0], ids[1]);
  assert.deepEqual(events, ["target", "transcribe", "release", "insert"]);
  await session.transcribe(); await session.retryInsertion();
  assert.equal(events.filter((event) => event === "insert").length, 1);
  assert.throws(() => session.begin());
});

test("cancelled transcription never inserts and new dictation waits for native completion", async () => {
  const response = deferred();
  let insertions = 0;
  const session = new TranscriptionSession(() => response.promise, () => {}, () => {},
    destination(async () => { insertions++; return sentPaste(); }));
  session.begin(); session.capture(recording());
  const firstId = session.sessionId;
  const pending = session.transcribe();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.state, "finalizing");
  assert.throws(() => session.begin());
  assert.equal(session.discard(), true);
  assert.equal(session.state, "discarded");
  assert.throws(() => session.begin());
  response.resolve("cancelled text");
  await pending;
  assert.equal(insertions, 0);
  assert.equal(session.transcript, "");
  session.begin();
  assert.notEqual(session.sessionId, firstId);
});

test("failed destination capture keeps usable text and frees audio for Copy", async () => {
  let released = 0;
  const session = new TranscriptionSession(async () => "recover me", () => {}, () => { released++; }, {
    ...destination(async () => assert.fail("Unavailable target pasted")),
    capture: async () => { throw new Error("target unavailable"); },
  });
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.equal(session.state, "failed");
  assert.equal(session.transcript, "recover me");
  assert.equal(session.audio, null);
  assert.equal(released, 1);
  assert.equal(session.canRetryInsertion, false);
});

test("only a confirmed refusal before paste permits insertion retry, without retranscription", async () => {
  let requests = 0, insertions = 0;
  const session = new TranscriptionSession(async () => { requests++; return "keep text"; }, () => {}, () => {},
    destination(async () => ++insertions === 1
      ? sentPaste({ pasteAttempted: false, pasteSent: false, message: "Target changed" }) : sentPaste()));
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.equal(session.state, "failed");
  assert.equal(session.canRetryInsertion, true);
  await session.retryInsertion(); await session.retryInsertion();
  assert.equal(session.state, "inserted");
  assert.equal(requests, 1);
  assert.equal(insertions, 2);
});

test("partial paste, restore failure, and unknown IPC outcome never permit automatic retry", async () => {
  for (const result of [sentPaste({ clipboardRestored: false }), sentPaste({ pasteSent: false }), null]) {
    let insertions = 0;
    const session = new TranscriptionSession(async () => "text", () => {}, () => {}, destination(async () => {
      insertions++;
      if (!result) throw new Error("IPC failed after paste");
      return result;
    }));
    session.begin(); session.capture(recording()); await session.transcribe();
    assert.equal(session.transcript, "text");
    assert.equal(session.canRetryInsertion, false);
    assert.equal(session.state, result?.pasteSent ? "inserted" : "failed");
    await session.retryInsertion(); await session.transcribe();
    assert.equal(insertions, 1);
  }
});

test("cancel while waiting for target capture cannot dispatch paste", async () => {
  const target = deferred(), textReady = deferred();
  const session = new TranscriptionSession(async () => "text", () => {
    if (session.transcript) textReady.resolve();
  }, () => {}, { ...destination(async () => assert.fail("Cancelled session pasted")), capture: () => target.promise });
  session.begin(); session.capture(recording());
  const pending = session.transcribe();
  await textReady.promise;
  session.discard(); target.resolve(); await pending;
  assert.equal(session.state, "discarded");
  assert.equal(session.transcript, "");
});

test("paste dispatch is an explicit noncancellable commit boundary", async () => {
  const paste = deferred(), dispatched = deferred();
  const session = new TranscriptionSession(async () => "text", () => {}, () => {}, destination(() => {
    dispatched.resolve(); return paste.promise;
  }));
  session.begin(); session.capture(recording()); const pending = session.transcribe();
  await dispatched.promise;
  assert.equal(session.inserting, true);
  assert.equal(session.discard(), false);
  assert.equal(session.transcript, "text");
  paste.resolve(sentPaste()); await pending;
  assert.equal(session.state, "inserted");
  assert.equal(session.discard(), true);
});

test("recording cancellation and empty capture leave an explicit discardable state", () => {
  const session = new TranscriptionSession(async () => assert.fail("No audio should send"), () => {}, () => {});
  session.begin(); session.failRecording();
  assert.equal(session.state, "failed"); assert.equal(session.canStart, false);
  session.discard(); session.begin(); session.discard(); session.failRecording();
  assert.equal(session.state, "discarded"); assert.equal(session.canStart, true);
});

test("synchronous destination IPC failures preserve transcript and local discard", async () => {
  const session = new TranscriptionSession(async () => "recoverable", () => {}, () => {}, {
    capture: () => { throw new Error("IPC unavailable"); },
    insert: async () => assert.fail("Uncaptured target pasted"),
    discard: () => { throw new Error("IPC unavailable"); },
  });
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.equal(session.state, "failed"); assert.equal(session.transcript, "recoverable");
  assert.equal(session.discard(), true);
  assert.equal(session.state, "discarded"); assert.equal(session.transcript, "");
});
