import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { LiveTranscription, Pcm16Resampler, MAX_LIVE_QUEUE_BYTES, liveErrorMessage } from "../src/liveTranscription.ts";
import { TranscriptionSession } from "../src/transcriptionSession.ts";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(overrides = {}) {
  const calls = [], listeners = new Map();
  let clock = 0, sequence = 0;
  const provider = {
    async start(id, receive) { calls.push(["start", id]); listeners.set(id, receive); },
    async append(id, bytes) { calls.push(["append", id, bytes]); },
    async finish(id) { calls.push(["finish", id]); },
    async cancel(id) { calls.push(["cancel", id]); },
    ...overrides,
  };
  const live = new LiveTranscription(provider, () => {}, () => clock, () => `stream-${++sequence}`);
  return { live, calls, listeners, clock: (value) => { clock = value; },
    event: (id, event) => listeners.get(id)({ streamId: id, ...event }) };
}

test("live finalization waits for completed words and closed stream rather than deltas", async () => {
  const f = fixture(); f.live.begin(); await tick();
  f.event("stream-1", { kind: "delta", itemId: "item", text: "Partial" });
  let settled = false;
  const pending = f.live.finishTranscript().then(text => { settled = true; return text; });
  await tick();
  assert.equal(settled, false);
  f.event("stream-1", { kind: "completed", itemId: "item", text: "Complete words." });
  await tick();
  assert.equal(settled, false);
  f.event("stream-1", { kind: "closed" });
  assert.equal(await pending, "Complete words.");
  assert.equal(f.calls.filter(call => call[0] === "finish").length, 1);
});

test("live finalization rejects failed, cancelled, incomplete and gapped streams", async () => {
  for (const outcome of ["failed", "cancelled", "incomplete", "gap"]) {
    const f = fixture(); f.live.begin(); await tick();
    f.event("stream-1", { kind: "delta", itemId: "item", text: "Partial" });
    const pending = f.live.finishTranscript();
    const rejection = assert.rejects(pending, code => code === "transcription_live_unavailable");
    await tick();
    if (outcome === "failed" || outcome === "gap") {
      f.event("stream-1", { kind: "error", code: "live_disconnected" });
      if (outcome === "gap") {
        f.live.reconnect();
        await assert.rejects(f.live.finishTranscript(), code => code === "transcription_live_unavailable");
      }
    } else if (outcome === "cancelled") f.live.cancel();
    else f.event("stream-1", { kind: "closed" });
    await rejection;
    f.live.cancel();
  }
});

test("24 kHz PCM16 conversion clips, preserves input, and averages 48 kHz samples", () => {
  const input = new Float32Array([-2, -1, 0, 1, 2, NaN]);
  const bytes = new Pcm16Resampler(24_000).push(input);
  const view = new DataView(bytes.buffer);
  assert.deepEqual(Array.from({ length: input.length }, (_, i) => view.getInt16(i * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]);
  assert.equal(input[0], -2);
  const averaged = new Pcm16Resampler(48_000).push(new Float32Array([1, -1, 0.5, 0.5]));
  assert.deepEqual([...averaged], [0, 0, 255, 63]);
});

test("44.1 kHz resampling has the same bytes across arbitrary chunk boundaries", () => {
  const input = Float32Array.from({ length: 44_100 }, (_, i) => Math.sin(i / 29));
  const whole = new Pcm16Resampler(44_100), split = new Pcm16Resampler(44_100);
  const expected = whole.push(input);
  const chunks = [];
  for (let offset = 0; offset < input.length; offset += 137) chunks.push(split.push(input.subarray(offset, offset + 137)));
  const result = Buffer.concat(chunks);
  assert.equal(expected.length, 48_000);
  assert.deepEqual(result, Buffer.from(expected));
  assert.equal(split.flush().length, 0);
  assert.throws(() => new Pcm16Resampler(0));
});

test("live deltas appear during capture; completion replaces deltas and latency starts at capture", async () => {
  const f = fixture(); f.live.begin(); f.clock(100); f.live.captureStarted();
  await tick();
  f.event("stream-1", { kind: "ready" });
  f.clock(480);
  f.event("stream-1", { kind: "delta", itemId: "item1", text: "你好 " });
  f.event("stream-1", { kind: "delta", itemId: "item1", text: "world" });
  assert.equal(f.live.state, "listening"); assert.equal(f.live.text, "你好 world");
  assert.equal(f.live.firstVisibleMs, 380);
  f.event("stream-1", { kind: "completed", itemId: "item1", text: "你好 world!" });
  f.event("stream-1", { kind: "delta", itemId: "item1", text: "late" });
  assert.equal(f.live.text, "你好 world!");
});

test("finish sends queued PCM and the final partial sample before commit", async () => {
  const gate = deferred(), f = fixture({ async start() { await gate.promise; } });
  f.live.begin();
  f.live.push(new Float32Array([0.5, 0.5, 0.5]), 48_000);
  const finish = f.live.finish();
  await tick(); assert.equal(f.calls.length, 0);
  gate.resolve(); await finish;
  assert.deepEqual(f.calls.map(c => c[0]), ["append", "append", "finish"]);
  assert.equal(f.calls.filter(c => c[0] === "append").reduce((n, c) => n + c[2].length, 0), 4);
});

test("the IPC queue is bounded and cancellation clears queued PCM during a stalled startup", async () => {
  const gate = deferred(), f = fixture({ async start() { await gate.promise; } });
  f.live.begin(); await tick();
  const samples = new Float32Array(4_096);
  for (let i = 0; i < Math.ceil(MAX_LIVE_QUEUE_BYTES / 8_192) + 1; i++) f.live.push(samples, 24_000);
  assert.equal(f.live.state, "failed"); assert.match(f.live.error, /keep up/);
  gate.resolve(); await tick(); await tick();
  assert.equal(f.calls.filter(c => c[0] === "append").length, 0);
  assert.equal(f.calls.filter(c => c[0] === "cancel").length, 1);
});

test("discard suppresses late stream events and waits for a pending native start before cancel", async () => {
  const gate = deferred(); let listener;
  const f = fixture({ async start(id, receive) { listener = receive; await gate.promise; } });
  f.live.begin(); await tick();
  f.live.cancel();
  listener({ streamId: "stream-1", kind: "delta", itemId: "a", text: "late text" });
  assert.equal(f.live.text, ""); assert.equal(f.live.state, "discarded");
  assert.equal(f.calls.length, 0);
  gate.resolve(); await tick(); await tick();
  assert.deepEqual(f.calls, [["cancel", "stream-1"]]);
});

test("reconnect keeps previous provisional words, marks the gap, and rejects old connection events", async () => {
  const f = fixture(); f.live.begin(); f.live.captureStarted(); await tick();
  f.event("stream-1", { kind: "delta", itemId: "a", text: "Before." });
  f.event("stream-1", { kind: "error", code: "live_disconnected" });
  assert.equal(f.live.text, "Before.");
  f.live.reconnect(); await tick(); await tick();
  f.event("stream-1", { kind: "delta", itemId: "a", text: "stale" });
  f.event("stream-2", { kind: "delta", itemId: "a", text: "After." });
  assert.equal(f.live.text, "Before.\n\n[Live preview gap]\n\nAfter.");
  assert.equal(f.live.hasGap, true);
  assert.ok(f.calls.findIndex(c => c[0] === "cancel") < f.calls.findIndex(c => c[1] === "stream-2"));
});

test("live failure never releases canonical retry audio or substitutes provisional text for insertion", async () => {
  let released = 0, failed = true;
  const inserted = [], original = new Blob([new Uint8Array(48)]);
  const final = new TranscriptionSession(async () => { if (failed) throw "validation_network_failed"; return "Canonical text."; },
    () => {}, () => released++, { async capture() {}, async insert(id, text) { inserted.push(text); return { pasteAttempted: true, pasteSent: true, clipboardRestored: true, message: "sent" }; }, async discard() {} });
  const f = fixture(); final.begin(); final.capture(original); f.live.begin(); await tick();
  f.event("stream-1", { kind: "delta", itemId: "a", text: "Incorrect provisional text." });
  f.event("stream-1", { kind: "error", code: "live_disconnected" });
  await final.transcribe();
  assert.equal(final.audio, original); assert.equal(released, 0); assert.equal(f.live.text, "Incorrect provisional text.");
  failed = false; await final.transcribe();
  assert.deepEqual(inserted, ["Canonical text."]); assert.equal(released, 1);
});

test("raw IPC/provider errors and inherited properties never reach the live UI", () => {
  for (const error of ["private fixture", "constructor", "__proto__", { message: "private fixture" }]) {
    assert.equal(liveErrorMessage(error), "Live transcription could not continue.");
  }
});

test("a new connection waits for cancelled native startup and cannot receive its late words", async () => {
  const gate = deferred(), calls = [], listeners = new Map();
  const f = fixture({
    async start(id, receive) { calls.push(["start", id]); listeners.set(id, receive); if (id === "stream-1") await gate.promise; },
    async cancel(id) { calls.push(["cancel", id]); },
  });
  f.live.begin(); await tick(); f.live.cancel(); f.live.begin(); await tick();
  assert.deepEqual(calls, [["start", "stream-1"]]);
  gate.resolve(); await tick(); await tick();
  assert.deepEqual(calls, [["start", "stream-1"], ["cancel", "stream-1"], ["start", "stream-2"]]);
  listeners.get("stream-1")({streamId:"stream-1",kind:"delta",itemId:"a",text:"stale"});
  assert.equal(f.live.text, "");
  listeners.get("stream-2")({streamId:"stream-2",kind:"delta",itemId:"a",text:"current"});
  assert.equal(f.live.text, "current");
});

test("probe mode retains canonical text without capturing a destination or dispatching paste", async () => {
  let captured = 0, inserted = 0;
  const session = new TranscriptionSession(async () => "Canonical text.", () => {}, () => {}, {
    async capture() { captured++; }, async insert() { inserted++; throw new Error("must not paste"); }, async discard() {},
  });
  session.begin(false); session.capture(new Blob([new Uint8Array(48)])); await session.transcribe();
  assert.equal(captured, 0); assert.equal(inserted, 0); assert.equal(session.transcript, "Canonical text.");
  assert.equal(session.state, "ready");
});

test("an oversized live preview stops streaming and retains only bounded recovery text", async () => {
  const f = fixture(); f.live.begin(); await tick();
  f.event("stream-1", {kind:"delta",itemId:"a",text:"x".repeat(600_000)});
  assert.equal(f.live.state, "failed");
  assert.equal(f.live.text.length, 524_288);
  assert.match(f.live.error, /size limit/);
});
