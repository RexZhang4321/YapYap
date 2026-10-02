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
