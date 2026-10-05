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

for (const fullAudio of [true, false]) {
  for (const cleanup of [true, false]) {
    test(`phases are independent: full audio ${fullAudio}, cleanup ${cleanup}`, async () => {
      let uploads = 0, cleans = 0, releases = 0;
      const inserted = [];
      const session = new TranscriptionSession(async () => { uploads++; return "Full audio words"; },
        () => {}, () => { releases++; }, {
          capture: async () => {}, discard: async () => {},
          insert: async (_id, text) => {
            inserted.push(text);
            return { pasteAttempted: true, pasteSent: true, clipboardRestored: true, message: "Inserted" };
          },
        }, { clean: async text => { cleans++; return text + "."; } });
      session.begin(true, cleanup, fullAudio);
      session.capture(recording());
      await session.transcribe(fullAudio ? undefined : async () => "Live words");
      const original = fullAudio ? "Full audio words" : "Live words";
      assert.equal(uploads, Number(fullAudio));
      assert.equal(cleans, Number(cleanup));
      assert.equal(session.transcript, original);
      assert.deepEqual(inserted, [original + (cleanup ? "." : "")]);
      assert.equal(session.state, "inserted");
      assert.equal(session.audio, null);
      assert.equal(releases, 1);
      assert.equal(session.usesFullAudio, fullAudio);
      if (!fullAudio) assert.equal(session.metrics.display("transcription"), "Skipped");
      if (!cleanup) assert.equal(session.metrics.display("cleanup"), "Skipped");
    });
  }
}

test("live failure keeps audio without uploading until an explicit full audio retry", async () => {
  let uploads = 0;
  const session = new TranscriptionSession(async () => { uploads++; return "Recovered words"; }, () => {}, () => {});
  session.begin(false, false, false);
  const audio = recording();
  session.capture(audio);
  await session.transcribe(async () => { throw "transcription_live_unavailable"; });
  assert.equal(session.audio, audio);
  assert.equal(session.state, "failed");
  assert.equal(uploads, 0);
  await session.transcribe();
  assert.equal(uploads, 1);
  assert.equal(session.transcript, "Recovered words");
});

test("stopping live finalization suppresses late words, cleanup and insertion", async () => {
  const live = deferred();
  let cleans = 0, inserts = 0;
  const session = new TranscriptionSession(async () => assert.fail("No upload"), () => {}, () => {}, {
    capture: async () => {}, discard: async () => {},
    insert: async () => { inserts++; },
  }, { clean: async () => { cleans++; return "Cleaned words"; } });
  session.begin(true, true, false);
  const audio = recording();
  session.capture(audio);
  const pending = session.transcribe(() => live.promise);
  assert.equal(session.stopWaiting(), true);
  await pending;
  live.resolve("Late live words");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.audio, audio);
  assert.equal(session.transcript, "");
  assert.equal(cleans, 0);
  assert.equal(inserts, 0);
});

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
    assert.equal(session.busy, false);
    assert.equal(session.canStart, true);
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

test("processing timings separate preparation, API requests and insertion and exclude speaking time", async () => {
  let clock = 50_000;
  const session = new TranscriptionSession(async () => { clock += 2400; return "hello"; },
    () => {}, () => {}, destination(async () => { clock += 300; return sentPaste(); }),
    { clean: async () => { clock += 800; return "Hello."; } }, undefined, () => clock);
  session.begin(true, true);
  clock += 60_000; // Speaking time must not appear in finalization latency.
  session.beginFinalization();
  clock += 120; // Worklet drain and WAV preparation.
  session.capture(recording());
  await session.transcribe();
  assert.equal(session.metrics.label, "After release");
  assert.equal(session.metrics.display("preparation"), "0.12 s");
  assert.equal(session.metrics.display("transcription"), "2.40 s");
  assert.equal(session.metrics.display("cleanup"), "0.80 s");
  assert.equal(session.metrics.display("insertion"), "0.30 s");
  assert.equal(session.metrics.display("total"), "3.62 s");
  clock += 10_000;
  assert.equal(session.metrics.display("total"), "3.62 s");
  session.begin();
  assert.equal(session.metrics, null);
});

test("timings record cleanup failure and refused insertion, then retry without repeating APIs", async () => {
  let clock = 0, calls = 0, insertions = 0;
  const session = new TranscriptionSession(async () => { calls++; clock += 1000; return "hello"; },
    () => {}, () => {}, destination(async () => { clock += 250; return ++insertions === 1
      ? sentPaste({ pasteAttempted: false, pasteSent: false }) : sentPaste(); }),
    { clean: async () => { calls++; clock += 500; throw "cleanup_network_failed"; } }, undefined, () => clock);
  session.begin(true, true);
  session.capture(recording());
  await session.transcribe();
  assert.equal(session.metrics.display("cleanup"), "0.50 s · failed");
  assert.equal(session.outputText, "hello");
  assert.equal(session.metrics.display("insertion"), "0.25 s · failed");
  assert.equal(session.metrics.total.status, "failed");
  assert.equal(session.canRetryInsertion, true);
  await session.retryInsertion();
  assert.equal(calls, 2);
  assert.equal(session.metrics.label, "Insertion retry");
  assert.equal(session.metrics.display("transcription"), "Skipped");
  assert.equal(session.metrics.display("cleanup"), "Skipped");
  assert.equal(session.metrics.display("total"), "0.25 s");
});

test("timings freeze on stop, reset on retry, and ignore the old request finishing", async () => {
  let clock = 0, calls = 0;
  const old = deferred(), next = deferred();
  const session = new TranscriptionSession(() => ++calls === 1 ? old.promise : next.promise,
    () => {}, () => {}, undefined, undefined, undefined, () => clock);
  session.begin(false, false);
  session.capture(recording());
  const first = session.transcribe();
  await new Promise(resolve => setImmediate(resolve));
  clock = 1500;
  assert.equal(session.metrics.display("transcription"), "1.50 s · running");
  session.stopWaiting();
  const stopped = session.metrics;
  assert.equal(stopped.display("transcription"), "1.50 s · stopped");
  clock = 2000;
  const second = session.transcribe();
  await new Promise(resolve => setImmediate(resolve));
  const current = session.metrics;
  old.resolve("Late old result");
  await first;
  assert.equal(session.metrics, current);
  assert.equal(current.running, true);
  clock = 2600;
  next.resolve("New result");
  await second;
  assert.equal(current.display("transcription"), "0.60 s");
  assert.equal(current.display("cleanup"), "Skipped");
  assert.equal(current.display("insertion"), "Skipped");
  assert.equal(stopped.display("total"), "1.50 s · stopped");
  session.discard();
  assert.equal(session.metrics, null);
});

test("failed transcription is timed and retains retry audio", async () => {
  let clock = 0;
  const session = new TranscriptionSession(async () => { clock += 750; throw "validation_timeout"; },
    () => {}, () => {}, undefined, undefined, undefined, () => clock);
  session.capture(recording());
  await session.transcribe();
  assert.equal(session.metrics.display("transcription"), "0.75 s · failed");
  assert.equal(session.metrics.display("total"), "0.75 s · failed");
  assert.ok(session.audio);
});

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
  session.begin();
  assert.equal(session.retainedResults[0].transcript, text);
  assert.equal(session.transcript, "");
  assert.notEqual(session.sessionId, ids[0]);
});

test("cancelled transcription never inserts and a new dictation can start immediately", async () => {
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
  session.begin();
  response.resolve("cancelled text");
  await pending;
  assert.equal(insertions, 0);
  assert.equal(session.transcript, "");
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
  assert.equal(session.canRetryInsertion, true);
});

test("only a confirmed refusal before paste permits insertion retry, without retranscription", async () => {
  let requests = 0, insertions = 0, focus = "original";
  const captures = [], targets = [];
  const session = new TranscriptionSession(async () => { requests++; return "keep text"; }, () => {}, () => {},
    { ...destination(async () => {
      targets.push(captures.at(-1));
      return ++insertions === 1
        ? sentPaste({ pasteAttempted: false, pasteSent: false, message: "Target changed" }) : sentPaste();
    }), capture: async () => { captures.push(focus); } });
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.equal(session.state, "failed");
  assert.equal(session.canRetryInsertion, true);
  focus = "chosen input";
  await session.retryInsertion(); await session.retryInsertion();
  assert.equal(session.state, "inserted");
  assert.equal(requests, 1);
  assert.equal(insertions, 2);
  assert.deepEqual(captures, ["original", "chosen input"]);
  assert.deepEqual(targets, ["original", "chosen input"]);
});

test("retry capture failure, timeout, and cancellation preserve text without dispatching paste", async () => {
  for (const outcome of ["failure", "timeout", "cancel"]) {
    let captures = 0, inserts = 0;
    const pending = deferred();
    const session = new TranscriptionSession(async () => "saved words", () => {}, () => {}, {
      ...destination(async () => { inserts++; return sentPaste({ pasteAttempted: false, pasteSent: false }); }),
      capture: async () => {
        if (++captures === 1) return;
        if (outcome === "failure") throw Error("Private capture detail");
        return pending.promise;
      },
    }, undefined, { stalledMs: 5, targetMs: 20, insertionMs: 100, transcriptionMs: 100, cleanupMs: 100 });
    session.begin(); session.capture(recording()); await session.transcribe();
    const retry = session.retryInsertion();
    assert.equal(session.busy, true);
    await session.retryInsertion();
    assert.equal(captures, 2);
    if (outcome === "cancel") session.discard();
    await retry;
    pending.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(inserts, 1);
    assert.equal(session.busy, false);
    assert.equal(session.transcript, outcome === "cancel" ? "" : "saved words");
    assert.equal(session.canRetryInsertion, outcome !== "cancel");
    if (outcome !== "cancel") assert.equal(session.error, "insertion_target_unavailable");
  }
});

test("initial capture failure permits an explicit shortcut retry at a new destination", async () => {
  let captures = 0, inserts = 0, requests = 0;
  const session = new TranscriptionSession(async () => { requests++; return "saved words"; }, () => {}, () => {}, {
    ...destination(async (_, text) => { inserts++; assert.equal(text, "saved words"); return sentPaste(); }),
    capture: async () => { if (++captures === 1) throw Error("Unavailable"); },
  });
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.equal(session.canRetryInsertion, true);
  await session.retryInsertion();
  assert.equal(session.state, "inserted");
  assert.equal(captures, 2); assert.equal(inserts, 1); assert.equal(requests, 1);
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

test("cleanup uses canonical final text, inserts cleaned output once, and retains both until discard", async () => {
  const canonical = "um hello world", cleaned = "Hello, world.";
  let stt = 0, cleanup = 0, releases = 0;
  const events = [], inserted = [];
  const session = new TranscriptionSession(async bytes => {
    stt++; assert.equal(bytes.length, 48); return canonical;
  }, () => {}, () => { releases++; events.push("release"); }, destination(async (_, text) => {
    inserted.push(text); events.push("insert"); return sentPaste();
  }), { clean: async text => {
    cleanup++; events.push("clean"); assert.equal(text, canonical);
    assert.equal(session.transcript, canonical); assert.equal(session.audio, null);
    assert.equal(session.busy, true); assert.equal(session.cleaning, true);
    return cleaned;
  } });
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.deepEqual(events, ["release", "clean", "insert"]);
  assert.deepEqual(inserted, [cleaned]);
  assert.equal(session.transcript, canonical); assert.equal(session.cleanedTranscript, cleaned);
  assert.equal(session.outputText, cleaned); assert.equal(session.cleanupWarning, null);
  assert.equal(session.state, "inserted"); assert.equal(session.cleaning, false);
  await session.transcribe(); await session.retryInsertion();
  assert.equal(stt, 1); assert.equal(cleanup, 1); assert.equal(releases, 1);
  assert.equal(session.discard(), true);
  assert.equal(session.transcript, ""); assert.equal(session.cleanedTranscript, null);
  assert.equal(session.outputText, "");
});

test("cleanup bypass is captured when recording begins and inserts the exact original", async () => {
  const original = "你好 😀\nAS5047P https://example.com/a?q=2 user_id 12.50";
  const session = new TranscriptionSession(async () => original, () => {}, () => {},
    destination(async (_, text) => { assert.equal(text, original); return sentPaste(); }),
    { clean: async () => assert.fail("Bypassed cleanup called") });
  session.begin(true, false); session.capture(recording()); await session.transcribe();
  assert.equal(session.state, "inserted"); assert.equal(session.transcript, original);
  assert.equal(session.cleanedTranscript, null); assert.equal(session.cleanupWarning, null);
});

test("failed or malformed cleanup falls back to canonical insertion with a separate fixed warning", async () => {
  // Runtime shape guards only; protected content/meaning checks are native tests.
  for (const bad of [null, {}, "", "  \n", "bad\u0000text", "bad\u0085text", "bad\u202etext", "x".repeat(65_537), "😀".repeat(16_385), new Error("secret provider detail")]) {
    const session = new TranscriptionSession(async () => "original", () => {}, () => {},
      destination(async (_, text) => { assert.equal(text, "original"); return sentPaste(); }),
      { clean: async () => { if (bad instanceof Error) throw bad; return bad; } });
    session.begin(); session.capture(recording()); await session.transcribe();
    assert.equal(session.transcript, "original"); assert.equal(session.outputText, "original");
    assert.equal(session.cleanedTranscript, null); assert.equal(session.cleanupWarning, "cleanup_failed");
    assert.equal(session.error, null); assert.equal(session.audio, null);
    assert.equal(session.state, "inserted");
    session.discard(); assert.equal(session.cleanupWarning, null);
  }
});

test("cancel during cleanup ignores late success/failure and releases the local lock immediately", async () => {
  for (const success of [true, false]) {
    const started = deferred(), response = deferred();
    const session = new TranscriptionSession(async () => "original", () => {}, () => {},
      destination(async () => assert.fail("Cancelled cleanup pasted")),
      { clean: () => { started.resolve(); return response.promise; } });
    session.begin(); session.capture(recording()); const pending = session.transcribe();
    await started.promise;
    assert.equal(session.transcript, "original"); assert.equal(session.audio, null);
    await session.transcribe(); assert.equal(session.discard(), true);
    assert.equal(session.busy, false); assert.equal(session.canStart, true);
    if (success) response.resolve("Original."); else response.reject("secret provider detail");
    await pending;
    assert.equal(session.transcript, ""); assert.equal(session.cleanedTranscript, null);
    assert.equal(session.cleanupWarning, null); assert.equal(session.error, null);
    assert.equal(session.cleaning, false); assert.equal(session.busy, false);
    assert.equal(session.state, "discarded"); assert.equal(session.canStart, true);
  }
});

test("insertion refusal retry reuses cleaned output without repeating either provider request", async () => {
  let stt = 0, cleanup = 0, insertions = 0;
  const session = new TranscriptionSession(async () => { stt++; return "um hello"; }, () => {}, () => {},
    destination(async (_, text) => {
      assert.equal(text, "Hello.");
      return ++insertions === 1 ? sentPaste({ pasteAttempted: false, pasteSent: false }) : sentPaste();
    }), { clean: async () => { cleanup++; return "Hello."; } });
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.equal(session.canRetryInsertion, true); assert.equal(session.error, "insertion_failed");
  assert.equal(session.transcript, "um hello"); assert.equal(session.cleanedTranscript, "Hello.");
  await Promise.all([session.retryInsertion(), session.retryInsertion()]);
  await session.transcribe(); await session.retryInsertion();
  assert.equal(stt, 1); assert.equal(cleanup, 1); assert.equal(insertions, 2);
  assert.equal(session.state, "inserted"); assert.equal(session.error, null);
});

test("cleaned output survives unavailable destination while canonical Copy stays exact", async () => {
  const session = new TranscriptionSession(async () => "um hello", () => {}, () => {}, {
    ...destination(async () => assert.fail("Unavailable target pasted")),
    capture: async () => { throw new Error("target unavailable"); },
  }, { clean: async () => "Hello." });
  session.begin(); session.capture(recording()); await session.transcribe();
  assert.equal(session.state, "failed"); assert.equal(session.error, "insertion_target_unavailable");
  assert.equal(session.transcript, "um hello"); assert.equal(session.outputText, "Hello.");
  assert.equal(session.audio, null); assert.equal(session.cleanupWarning, null);
});
