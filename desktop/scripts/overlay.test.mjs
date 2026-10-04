import assert from 'node:assert/strict';
import test from 'node:test';
import { OverlayController, overlayPhase } from '../src/overlayState.ts';
import { TranscriptionSession } from '../src/transcriptionSession.ts';

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
  assert.deepEqual(sent, [{ epoch: 1, revision: 11, phase: 'recording' }]);
  slow.resolve(); await tick();
  assert.deepEqual(sent, [{ epoch: 1, revision: 11, phase: 'recording' }, { epoch: 1, revision: 12, phase: 'hidden' }]);
  controller.update('hidden'); await tick();
  assert.equal(sent.length, 2); assert.ok(reports.every(failed => !failed));
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
