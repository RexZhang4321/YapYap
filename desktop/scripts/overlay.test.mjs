import assert from 'node:assert/strict';
import test from 'node:test';
import { OverlayController, OverlayReceiver, overlayPhase, overlayContent, overlayPresentation, MAX_OVERLAY_TEXT } from '../src/overlayState.ts';
import { TranscriptionSession } from '../src/transcriptionSession.ts';
import { LiveTranscription } from '../src/liveTranscription.ts';
import { encodeWav } from '../src/audioCapture.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const base = { state: 'idle', busy: false, inserting: false, error: null, insertion: null, interrupted: false, stopping: false };

test('recovery stays visible, success hides, discard always hides even during outstanding work', () => {
  assert.equal(overlayPhase({ ...base, state: 'recording' }), 'recording');
  assert.equal(overlayPhase({ ...base, state: 'recording', stopping: true }), 'processing');
  assert.equal(overlayPhase({ ...base, state: 'finalizing', busy: true }), 'processing');
  assert.equal(overlayPhase({ ...base, state: 'ready' }), 'ready');
  assert.equal(overlayPhase({ ...base, state: 'failed' }), 'error');
  assert.equal(overlayPhase({ ...base, state: 'ready', interrupted: true }), 'error');
  assert.equal(overlayPhase({ ...base, state: 'inserted', insertion: { pasteSent: true, clipboardRestored: false } }), 'error');
  assert.equal(overlayPhase({ ...base, state: 'inserted', insertion: { pasteSent: true, clipboardRestored: true } }), 'hidden');
  assert.equal(overlayPhase({ ...base, state: 'inserted', interrupted: true, insertion: { pasteSent: true, clipboardRestored: true } }), 'hidden');
  assert.equal(overlayPhase({ ...base, state: 'discarded', busy: true, error: 'failure', interrupted: true }), 'hidden');
});

test('slow shows are serialized before discard; pending states coalesce and repeats send once', async () => {
  const slow = deferred(), sent = [], reports = [];
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 10, phase: 'hidden' }), async snapshot => {
    sent.push(snapshot); if (snapshot.phase === 'recording') await slow.promise;
  }, failed => reports.push(failed));
  controller.update('recording'); await tick();
  controller.update('processing'); controller.update('hidden');
  assert.deepEqual(sent, [{ epoch: 1, revision: 11, ...overlayContent('recording') }]);
  slow.resolve(); await tick();
  assert.deepEqual(sent, [{ epoch: 1, revision: 11, ...overlayContent('recording') }, { epoch: 1, revision: 12, ...overlayContent('hidden') }]);
  controller.update('hidden'); await tick();
  assert.equal(sent.length, 2); assert.ok(reports.every(failed => !failed));
});

test('same-phase words and reconnect changes publish; identical content coalesces', async () => {
  const sent = [], slow = deferred();
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 0 }), async snapshot => {
    sent.push(snapshot); if (sent.length === 1) await slow.promise;
  }, () => {});
  const live = { state: 'listening', text: 'first', hasGap: false };
  controller.update('recording', live); await tick();
  live.text = 'second'; controller.update('recording', live);
  live.text = 'latest'; controller.update('recording', live);
  slow.resolve(); await tick();
  assert.deepEqual(sent.map(s => s.text), ['first', 'latest']);
  controller.update('recording', live); await tick(); assert.equal(sent.length, 2);
  live.hasGap = true; controller.update('recording', live); await tick();
  live.state = 'failed'; controller.update('recording', live); await tick();
  assert.equal(sent.at(-1).preview, 'failed'); assert.equal(sent.at(-1).hasGap, true);
  assert.deepEqual(sent.map(s => s.revision), [1, 2, 3, 4]);
});

test('preview tails preserve Unicode and hidden/off content never carries prior words', () => {
  const live = { state: 'listening', text: 'prefix😀' + '尾'.repeat(MAX_OVERLAY_TEXT - 1), hasGap: true };
  const content = overlayContent('recording', live);
  assert.equal(content.text, '尾'.repeat(MAX_OVERLAY_TEXT - 1));
  assert.deepEqual(overlayContent('hidden', live), { phase: 'hidden', text: '', preview: 'off', hasGap: false });
  assert.equal(overlayContent('recording').text, '');
  const literal = '<img src=x onerror=alert(1)>\n你好 😀 https://example.com';
  assert.equal(overlayPresentation(overlayContent('recording', { ...live, text: literal })).text, literal);
});

test('preview is labelled provisional and failures do not replace session processing/recovery', () => {
  const live = { state: 'connecting', text: '', hasGap: false };
  assert.match(overlayPresentation(overlayContent('recording', live)).text, /Connecting/);
  live.state = 'listening'; live.text = 'words';
  assert.equal(overlayPresentation(overlayContent('recording', live)).label, 'Provisional');
  live.state = 'failed';
  const failure = overlayPresentation(overlayContent('recording', live));
  assert.match(failure.title, /Listening/); assert.match(failure.hint, /Recording continues/); assert.equal(failure.warning, true);
  assert.equal(overlayPresentation(overlayContent('processing', live)).title, 'Finalizing');
  assert.equal(overlayPresentation(overlayContent('error', live)).title, 'Needs attention');
  live.state = 'listening'; live.hasGap = true;
  assert.match(overlayPresentation(overlayContent('recording', live)).hint, /gap/);
});

test('receiver rejects old snapshots/events after hide or owner replacement and validates budgets', () => {
  const receiver = new OverlayReceiver();
  const preview = { epoch: 1, revision: 1, ...overlayContent('recording', { state: 'listening', text: 'words', hasGap: false }) };
  assert.equal(receiver.accept(preview), true);
  assert.equal(receiver.accept({ ...preview, revision: 2, ...overlayContent('hidden') }), true);
  assert.equal(receiver.accept(preview), false);
  assert.equal(receiver.accept({ ...preview, epoch: 2, revision: 0, ...overlayContent('hidden') }), true);
  assert.equal(receiver.accept({ ...preview, revision: 999 }), false);
  assert.equal(receiver.accept({ ...preview, epoch: 2, text: 'a'.repeat(MAX_OVERLAY_TEXT + 1) }), false);
  assert.equal(receiver.accept({ ...preview, epoch: 2, phase: 'hidden' }), false);
  assert.equal(receiver.accept({ ...preview, epoch: 2, preview: 'unknown' }), false);
  assert.equal(receiver.accept({ ...preview, epoch: 2, revision: 1 }), true);
});

test('live overlay survives preview failure; only canonical text is inserted and late live words cannot reopen success', async () => {
  const sent = [], listeners = new Map(), pasted = [];
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 0 }), async snapshot => sent.push(snapshot), () => {});
  let session, live, stream = 0;
  const publish = () => controller.update(overlayPhase({ ...base, ...session }), live);
  live = new LiveTranscription({
    async start(id, receive) { listeners.set(id, receive); }, async append() {}, async finish() {}, async cancel() {},
  }, publish, () => 0, () => `live-${++stream}`);
  session = new TranscriptionSession(async () => 'canonical only', publish, () => {}, {
    async capture() {}, async discard() {}, async insert(id, text) {
      pasted.push(text); return { pasteAttempted: true, pasteSent: true, clipboardRestored: true };
    },
  });
  session.begin(); live.begin(); await tick();
  const receive = listeners.get('live-1');
  receive({ streamId: 'live-1', kind: 'delta', itemId: 'one', text: 'provisional words' }); await tick();
  assert.equal(sent.at(-1).text, 'provisional words'); assert.equal(pasted.length, 0);
  const original = new Blob([new Uint8Array(48)]); session.capture(original);
  receive({ streamId: 'live-1', kind: 'error', code: 'live_disconnected' }); await tick();
  assert.equal(session.audio, original); assert.equal(sent.at(-1).preview, 'failed');
  live.reconnect(); await tick();
  listeners.get('live-2')({ streamId: 'live-2', kind: 'delta', itemId: 'two', text: 'after gap' }); await tick();
  assert.equal(sent.at(-1).hasGap, true);
  await session.transcribe(); await tick();
  assert.deepEqual(pasted, ['canonical only']); assert.equal(session.audio, null);
  assert.equal(sent.at(-1).phase, 'hidden'); assert.equal(sent.at(-1).text, '');
  listeners.get('live-2')({ streamId: 'live-2', kind: 'delta', itemId: 'two', text: 'late' }); await tick();
  assert.equal(sent.at(-1).phase, 'hidden'); assert.equal(sent.at(-1).text, '');
  session.discard(); live.cancel(); await tick();
  session.begin(false); controller.update('recording'); await tick();
  assert.equal(sent.at(-1).text, ''); assert.equal(sent.at(-1).preview, 'off');
});

test('cancel during a delayed preview send clears words and suppresses old-stream events', async () => {
  const sent = [], slow = deferred(); let receive, live, phase = 'recording';
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 0 }), async snapshot => {
    sent.push(snapshot); if (snapshot.text) await slow.promise;
  }, () => {});
  live = new LiveTranscription({ async start(id, callback) { receive = event => callback({ streamId: id, ...event }); },
    async append() {}, async finish() {}, async cancel() {},
  }, () => controller.update(phase, live));
  live.begin(); await tick();
  receive({ kind: 'delta', itemId: 'one', text: 'before cancel' }); await tick();
  phase = 'hidden'; live.cancel();
  receive({ kind: 'delta', itemId: 'one', text: 'late' });
  slow.resolve(); await tick();
  assert.equal(sent.at(-1).phase, 'hidden'); assert.equal(sent.at(-1).text, ''); assert.equal(live.text, '');
});

test('whole-recording finalization and retry are independent of unfinished live text and keep the original target', async () => {
  const sent = [], uploaded = [], captures = [], inserted = [];
  let session, live, receive, attempts = 0;
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 0 }), async snapshot => sent.push(snapshot), () => {});
  const publish = () => controller.update(overlayPhase({ ...base, ...session }), live);
  live = new LiveTranscription({
    async start(id, callback) { receive = event => callback({ streamId: id, ...event }); },
    async append() {}, async finish() {}, async cancel() {},
  }, publish);
  session = new TranscriptionSession(async bytes => {
    uploaded.push(bytes);
    if (++attempts === 1) throw 'transcription_network_failed';
    return 'Canonical result 42 https://example.com/a_1';
  }, publish, () => {}, {
    async capture(id) { captures.push(id); }, async discard() {},
    async insert(id, text) { inserted.push({ id, text }); return { pasteSent: true, pasteAttempted: true, clipboardRestored: true }; },
  });
  session.begin(); live.begin(); await tick();
  receive({ kind: 'delta', itemId: 'one', text: 'Unfinished provisional words' });
  // A nonuniform sample sequence catches truncation/reordering and preview conversion.
  const chunks = [new Float32Array([0.1, -0.5, 0.9]), new Float32Array([0.4, -0.3])];
  const audio = encodeWav({ samples: chunks, sampleRate: 48000, channelCount: 1, frameCount: 5 });
  session.capture(audio); void live.finish();
  await session.transcribe(); await tick();
  assert.equal(live.state, 'finishing'); assert.equal(session.audio, audio);
  assert.equal(session.state, 'failed'); assert.equal(sent.at(-1).phase, 'error');
  assert.equal(inserted.length, 0); assert.equal(session.transcript, '');
  await session.transcribe(); await tick();
  const expectedBytes = new Uint8Array(await audio.arrayBuffer());
  assert.deepEqual(uploaded, [expectedBytes, expectedBytes]);
  assert.equal(captures.length, 1);
  assert.deepEqual(inserted, [{ id: captures[0], text: 'Canonical result 42 https://example.com/a_1' }]);
  assert.equal(session.audio, null); assert.equal(session.state, 'inserted');
  assert.equal(live.text, 'Unfinished provisional words');
  assert.equal(sent.at(-1).phase, 'hidden'); assert.equal(sent.at(-1).text, '');
  // Finalization did not wait for preview completion. Its late completion cannot reopen success.
  receive({ kind: 'completed', itemId: 'one', text: 'Different live result' }); await tick();
  assert.equal(sent.at(-1).phase, 'hidden'); assert.equal(inserted.length, 1);
  live.cancel();
});

test('overlay failures do not break dictation and a later update retries', async () => {
  let attempts = 0; const reports = [];
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 0, phase: 'hidden' }), async () => {
    if (++attempts === 1) throw Error('native window failure');
  }, failed => reports.push(failed));
  controller.update('recording'); await tick();
  controller.update('hidden'); await tick();
  assert.deepEqual(reports, [true, false]); assert.equal(attempts, 2);
});

test('a failed slow show still sends a newer discard hide', async () => {
  let reject; const slow = new Promise((_, no) => { reject = no; }); const sent = [];
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 0, phase: 'hidden' }), async snapshot => {
    sent.push(snapshot.phase); if (snapshot.phase === 'recording') await slow;
  }, () => {});
  controller.update('recording'); await tick();
  controller.update('hidden'); reject(Error('failed show')); await tick();
  assert.deepEqual(sent, ['recording', 'hidden']);
});

test('cancel during transcription hides overlay and late provider response cannot restore it', async () => {
  const provider = deferred(), snapshots = [];
  const controller = new OverlayController(async () => ({ epoch: 1, revision: 0, phase: 'hidden' }), async snapshot => snapshots.push(snapshot), () => {});
  let session;
  session = new TranscriptionSession(() => provider.promise, () => controller.update(overlayPhase({ ...base, ...session })), () => {});
  session.capture(new Blob([new Uint8Array(48)]));
  const request = session.transcribe(); await tick();
  session.discard(); await tick();
  provider.resolve('late words'); await request; await tick();
  assert.equal(snapshots.at(-1).phase, 'hidden'); assert.equal(session.transcript, '');
  assert.equal(snapshots.filter(snapshot => snapshot.phase === 'hidden').length, 1);
});
