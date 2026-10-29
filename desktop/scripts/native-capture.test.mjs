import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { microphoneErrorMessage } from "../src/audioCapture.ts";
import { NativePcmRecorder } from "../src/nativeCapture.ts";

function chunk(values) {
  return Float32Array.from(values).buffer;
}

function fakeTransport({ startError, sampleRate = 48_000 } = {}) {
  const calls = { starts: [], stops: 0 };
  let emit = () => {};
  let flushOnStop = true;
  const transport = {
    calls,
    emit: (event) => emit(event),
    keepFlush: () => { flushOnStop = false; },
    async start(deviceName, onEvent) {
      calls.starts.push(deviceName);
      if (startError) throw startError;
      emit = onEvent;
      return { sampleRate, channelCount: 2, deviceName: deviceName || "MacBook Pro Microphone" };
    },
    async stop() {
      calls.stops += 1;
      if (flushOnStop) emit({ type: "flushed", callbacks: 3 });
      return { callbacks: 3 };
    },
  };
  return transport;
}

test("native capture keeps chunks in order, previews them and drops audio after the flush", async () => {
  const transport = fakeTransport();
  const levels = [], previews = [];
  const recorder = new NativePcmRecorder(() => {}, () => {}, (rms) => levels.push(rms),
    (samples, rate) => previews.push([samples.length, rate]), transport);
  assert.match(await recorder.start(""), /MacBook Pro Microphone at 48,000 Hz/);
  assert.deepEqual(transport.calls.starts, [""]);
  transport.emit(chunk([0.5, -0.5]));
  transport.emit(Array.from(new Uint8Array(chunk([0.25]))));
  const recording = await recorder.stop();
  transport.emit(chunk([0.9]));
  assert.deepEqual(Array.from(recording.samples[0]), [0.5, -0.5, 0.25]);
  assert.equal(recording.frameCount, 3);
  assert.equal(recording.sampleRate, 48_000);
  assert.equal(recording.workletProcessCalls, 3);
  assert.equal(recording.workletInputChannels, 2);
  assert.deepEqual(previews, [[2, 48_000], [1, 48_000]]);
  assert.ok(levels.some((level) => level > 0.4));
  assert.equal(recorder.hasPlayableRecording, true);
  await assert.rejects(recorder.start(""), /Clear the previous recording/);
  recorder.clear();
  assert.equal(recorder.hasRecording, false);
});

test("device loss stops native capture and reports the retained audio", async () => {
  const transport = fakeTransport();
  let reported;
  const stopped = new Promise((resolve) => {
    reported = resolve;
  });
  const recorder = new NativePcmRecorder((recording, message) => reported({ recording, message }),
    () => {}, () => {}, undefined, transport);
  await recorder.start("");
  transport.emit(chunk([0.1, 0.2]));
  transport.emit({ type: "ended" });
  const { recording, message } = await stopped;
  assert.match(message, /disconnected/);
  assert.equal(recording.frameCount, 2);
  assert.equal(recording.trackState, "ended");
  assert.equal(transport.calls.stops, 1);
  assert.equal(recorder.isRecording, false);
});

test("native failures map to the shared microphone messages", async () => {
  for (const [code, pattern] of [
    ["microphone_denied", /denied/i],
    ["microphone_device_missing", /no longer available/],
    ["microphone_unavailable", /No microphone input/],
    ["microphone_start_failed", /could not be opened/],
  ]) {
    const recorder = new NativePcmRecorder(() => {}, () => {}, () => {}, undefined,
      fakeTransport({ startError: code }));
    const error = await recorder.start("").catch((failure) => failure);
    assert.match(microphoneErrorMessage(error), pattern);
    assert.equal(recorder.isRecording, false);
  }
});

test("a selected WebView device is opened by its label and a missing one is refused", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    enumerateDevices: async () => [
      { kind: "audioinput", deviceId: "usb-id", label: "USB Mic Pro (0d8c:0014)" },
      { kind: "videoinput", deviceId: "camera", label: "Camera" },
    ],
  } } });
  try {
    const transport = fakeTransport();
    const recorder = new NativePcmRecorder(() => {}, () => {}, () => {}, undefined, transport);
    await recorder.start("usb-id");
    assert.deepEqual(transport.calls.starts, ["USB Mic Pro (0d8c:0014)"]);
    assert.equal(recorder.activeDeviceId, "usb-id");
    await recorder.stop();
    recorder.clear();
    const error = await recorder.start("camera").catch((failure) => failure);
    assert.match(microphoneErrorMessage(error), /no longer available/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous); else delete globalThis.navigator;
  }
});

test("cancelled startup releases the native capture that opened late", async () => {
  const transport = fakeTransport();
  let release;
  const opened = new Promise((resolve) => { release = resolve; });
  const start = transport.start;
  transport.start = async (...args) => { await opened; return start(...args); };
  const recorder = new NativePcmRecorder(() => {}, () => {}, () => {}, undefined, transport);
  const pending = recorder.start("");
  await Promise.resolve();
  recorder.cancelStartup();
  release();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(transport.calls.stops, 1);
  assert.equal(recorder.isRecording, false);
});

test("stop finishes after a bounded wait when the flush marker never arrives", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const transport = fakeTransport();
    transport.keepFlush();
    const recorder = new NativePcmRecorder(() => {}, () => {}, () => {}, undefined, transport);
    await recorder.start("");
    transport.emit(chunk([0.3]));
    const stopped = recorder.stop();
    assert.equal(recorder.isStopping, true);
    await Promise.resolve();
    await Promise.resolve();
    mock.timers.tick(1500);
    const recording = await stopped;
    assert.equal(recording.frameCount, 1);
    assert.equal(recorder.isStopping, false);
  } finally {
    mock.timers.reset();
  }
});
