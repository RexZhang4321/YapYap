import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { encodeWav } from "../src/audioCapture.ts";
import { Pcm16Resampler } from "../src/liveTranscription.ts";

test("microphone worklet preserves quiet input samples across blocks and flush", () => {
  let Processor;
  class AudioWorkletProcessor {
    constructor() {
      this.events = [];
      this.port = { postMessage: (event) => this.events.push(event), onmessage: null };
    }
  }
  vm.runInNewContext(readFileSync(new URL("../public/pcm-capture-worklet.js", import.meta.url), "utf8"), {
    AudioWorkletProcessor,
    Float32Array,
    registerProcessor: (_name, implementation) => { Processor = implementation; },
  });
  const processor = new Processor();
  const input = Float32Array.from({ length: 5000 }, (_, index) => (index % 19 - 9) / 1000);
  const output = new Float32Array(input.length).fill(1);
  processor.process([[input]], [[output]]);
  processor.port.onmessage({ data: { type: "flush" } });
  const chunks = processor.events.filter(event => event.type === "pcm")
    .map(event => new Float32Array(event.buffer));
  assert.deepEqual(chunks.map(chunk => chunk.length), [4096, 904]);
  assert.deepEqual([...chunks[0], ...chunks[1]], [...input]);
  assert.ok(output.every(sample => sample === 0));
});

test("quiet speech-like PCM reaches the live and whole-audio encoders at comparable levels", async () => {
  const samples = Float32Array.from({ length: 4800 }, (_, index) => 0.01 * Math.sin(index * 2 * Math.PI * 120 / 48000));
  const wav = await encodeWav({ samples: [samples], sampleRate: 48000, channelCount: 1, frameCount: samples.length }).arrayBuffer();
  const preview = new Pcm16Resampler(48000).push(samples);
  const rms = (view, offset, count) => {
    let sum = 0;
    for (let index = 0; index < count; index++) {
      const value = view.getInt16(offset + index * 2, true) / 32768;
      sum += value * value;
    }
    return Math.sqrt(sum / count);
  };
  const fileLevel = rms(new DataView(wav), 44, samples.length);
  const liveLevel = rms(new DataView(preview.buffer, preview.byteOffset, preview.byteLength), 0, preview.byteLength / 2);
  assert.ok(fileLevel > 0.006 && fileLevel < 0.008);
  assert.ok(Math.abs(fileLevel - liveLevel) < 0.0001);
});
