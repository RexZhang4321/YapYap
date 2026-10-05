import assert from 'node:assert/strict';
import test from 'node:test';
import { TranscriptionSession } from '../src/transcriptionSession.ts';
import { LiveTranscription } from '../src/liveTranscription.ts';
import { OverlayController, overlayPhase } from '../src/overlayState.ts';
import { encodeWav } from '../src/audioCapture.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const canonical = 'um send 42 to user_id\n你好 😀 https://example.com/a?q=2 main.rs';
const cleaned = 'Send 42 to user_id.\n你好 😀 https://example.com/a?q=2 main.rs';
const provisional = 'A different provisional draft\n你好 😀';
const paste = { pasteAttempted: true, pasteSent: true, clipboardRestored: true, message: 'fixture' };
const baseOverlay = { interrupted: false, stopping: false };

// Small real-component harness: only provider/destination/native overlay seams
// are fixtures. Nonuniform complete PCM detects truncation, reordering, or
// accidental reuse of the separately resampled preview audio.
function harness(options = {}) {
  const chunks = [new Float32Array([0.1, -0.5, 0.9]), new Float32Array([0.4, -0.3, 0.25, 0.8])];
  const original = encodeWav({ samples: [Float32Array.from(chunks.flatMap(chunk => [...chunk]))],
    sampleRate: 48000, channelCount: 1, frameCount: 7 });
  const uploads = [], inserts = [], captures = [], snapshots = [], listeners = new Map(), order = [];
  let session, live, stream = 0, cleanupCalls = 0, releases = 0;
  const overlay = new OverlayController(async () => ({ epoch: 1, revision: 0 }), async snapshot => {
    snapshots.push(snapshot);
    if (options.sendOverlay) await options.sendOverlay(snapshot);
  }, () => {});
  const publish = () => overlay.update(overlayPhase({ ...baseOverlay, ...session }), live);
  live = new LiveTranscription({
    async start(id, receive) {
      listeners.set(id, event => receive({ streamId: id, ...event }));
      receive({ streamId: id, kind: 'ready' });
    },
    async append() {},
    async finish(id) {
      if (options.finishPreview) await options.finishPreview();
      listeners.get(id)({ kind: 'closed' });
    },
    async cancel() {},
  }, publish, () => 0, () => `stream-${++stream}`);
  session = new TranscriptionSession(async bytes => {
    uploads.push(bytes.slice()); order.push('final');
    if (options.finalResult) return options.finalResult(uploads.length);
    if (options.finalRetry && uploads.length === 1) throw 'transcription_network_failed';
    return canonical;
  }, publish, () => { releases++; order.push('release-audio'); }, {
    async capture(id) { captures.push(id); order.push('capture-target'); },
    async discard() {},
    async insert(id, text) {
      inserts.push({ id, text }); order.push('insert');
      if (options.insertResult) return options.insertResult(inserts.length);
      if (options.insertion === 'refusal' && inserts.length === 1) return { ...paste, pasteAttempted: false, pasteSent: false };
      if (options.insertion === 'partial') return { ...paste, pasteSent: false };
      if (options.insertion === 'unknown') throw new Error('private fixture detail');
      if (options.insertion === 'restore') return { ...paste, clipboardRestored: false };
      return paste;
    },
  }, { async clean(text) {
    cleanupCalls++; order.push('cleanup');
    assert.equal(text, canonical);
    if (options.cleanupResult) return options.cleanupResult();
    if (options.cleanup === 'failure') throw new Error('private fixture detail');
    return cleaned;
  } });
  return {
    session, live, original, uploads, inserts, captures, snapshots, order,
    get cleanupCalls() { return cleanupCalls; }, get releases() { return releases; },
    get receive() { return listeners.get(`stream-${stream}`); },
    async begin() {
      session.begin(true, options.cleanup !== 'bypass'); live.begin(); live.captureStarted();
      await tick();
      this.receive({ kind: 'delta', itemId: 'one', text: provisional });
      chunks.forEach(chunk => live.push(chunk, 48000)); await tick();
    },
    release() { session.capture(original); void live.finish(); return session.transcribe(); },
    async discard() { assert.equal(session.discard(), true); live.cancel(); await tick(); },
  };
}

test('combined recovery matrix preserves source hierarchy and prevents repeated requests/pastes', async t => {
  for (const previewFailure of [false, true]) {
    for (const finalRetry of [false, true]) {
      for (const cleanup of ['success', 'failure', 'bypass']) {
        for (const insertion of ['success', 'refusal', 'partial', 'unknown', 'restore']) {
          await t.test(`live=${previewFailure ? 'failed' : 'completed'} final=${finalRetry ? 'retry' : 'success'} cleanup=${cleanup} insertion=${insertion}`, async () => {
            const h = harness({ finalRetry, cleanup, insertion });
            await h.begin();
            if (previewFailure) h.receive({ kind: 'error', code: 'live_disconnected' });
            const finalizing = h.release();
            await Promise.all([h.session.transcribe(), h.session.transcribe(), finalizing]);
            await tick();
            if (finalRetry) {
              assert.equal(h.session.state, 'failed'); assert.equal(h.session.audio, h.original);
              assert.equal(h.session.transcript, ''); assert.equal(h.live.text, provisional);
              assert.equal(h.cleanupCalls, 0); assert.equal(h.inserts.length, 0); assert.equal(h.releases, 0);
              assert.equal(h.snapshots.at(-1).phase, 'error'); assert.equal(h.snapshots.at(-1).text, provisional);
              // Release/retry bursts lock synchronously and send the retained full WAV once.
              await Promise.all([h.session.transcribe(), h.session.transcribe(), h.session.transcribe()]);
              await tick();
            }
            const expectedBytes = new Uint8Array(await h.original.arrayBuffer());
            assert.equal(h.uploads.length, finalRetry ? 2 : 1);
            h.uploads.forEach(bytes => assert.deepEqual(bytes, expectedBytes));
            assert.equal(h.session.audio, null); assert.equal(h.releases, 1);
            assert.equal(h.session.transcript, canonical); assert.equal(h.live.text, provisional);
            const selected = cleanup === 'success' ? cleaned : canonical;
            assert.equal(h.session.outputText, selected);
            assert.equal(h.session.cleanedTranscript, cleanup === 'success' ? cleaned : null);
            assert.equal(h.session.cleanupWarning, cleanup === 'failure' ? 'cleanup_failed' : null);
            assert.equal(h.cleanupCalls, cleanup === 'bypass' ? 0 : 1);
            assert.equal(h.captures.length, 1);
            assert.deepEqual(h.inserts, [{ id: h.captures[0], text: selected }]);
            assert.ok(h.order.indexOf('release-audio') < h.order.indexOf('insert'));
            if (cleanup !== 'bypass') {
              assert.ok(h.order.indexOf('release-audio') < h.order.indexOf('cleanup'));
              assert.ok(h.order.indexOf('cleanup') < h.order.indexOf('insert'));
            }
            if (insertion === 'refusal') {
              assert.equal(h.session.canRetryInsertion, true);
              await Promise.all([h.session.retryInsertion(), h.session.retryInsertion(), h.session.retryInsertion()]);
              assert.deepEqual(h.inserts, [
                { id: h.captures[0], text: selected }, { id: h.captures[0], text: selected },
              ]);
            } else assert.equal(h.session.canRetryInsertion, false);
            await Promise.all([h.session.transcribe(), h.session.retryInsertion(), h.session.retryInsertion()]);
            await tick();
            assert.equal(h.uploads.length, finalRetry ? 2 : 1);
            assert.equal(h.cleanupCalls, cleanup === 'bypass' ? 0 : 1);
            assert.equal(h.inserts.length, insertion === 'refusal' ? 2 : 1);
            assert.equal(h.session.transcript, canonical); assert.equal(h.session.outputText, selected);
            assert.equal(h.live.text, provisional); assert.equal(h.session.canStart, false);
            assert.equal(h.snapshots.at(-1).phase, ['partial', 'unknown', 'restore'].includes(insertion) ? 'error' : 'hidden');
            if (insertion === 'unknown') assert.equal(h.session.error, 'insertion_outcome_unknown');
            await h.discard();
            assert.equal(h.session.transcript, ''); assert.equal(h.session.cleanedTranscript, null);
            assert.equal(h.session.cleanupWarning, null); assert.equal(h.live.text, '');
            assert.equal(h.snapshots.at(-1).phase, 'hidden'); assert.equal(h.snapshots.at(-1).text, '');
            assert.equal(h.session.canStart, true);
          });
        }
      }
    }
  }
});

test('cancel matrix ignores late final/cleanup success or failure and immediately permits a new local session', async t => {
  for (const stage of ['final', 'cleanup']) {
    for (const success of [false, true]) {
      for (const previewFailure of [false, true]) {
        await t.test(`cancel=${stage} late=${success ? 'success' : 'failure'} preview=${previewFailure ? 'failed' : 'active'}`, async () => {
          const started = deferred(), pending = deferred();
          const h = harness(stage === 'final'
            ? { finalResult: () => { started.resolve(); return pending.promise; } }
            : { cleanupResult: () => { started.resolve(); return pending.promise; } });
          await h.begin();
          if (previewFailure) h.receive({ kind: 'error', code: 'live_disconnected' });
          const oldReceive = h.receive;
          const request = h.release(); await started.promise;
          assert.equal(h.session.state, 'finalizing'); assert.equal(h.session.canStart, false);
          assert.throws(() => h.session.begin());
          await h.discard();
          assert.equal(h.session.busy, false); assert.equal(h.session.canStart, true);
          oldReceive({ kind: 'delta', itemId: 'late', text: 'Old-stream words must be ignored' });
          if (success) pending.resolve(stage === 'final' ? canonical : cleaned);
          else pending.reject('transcription_network_failed');
          await request; await tick();
          assert.equal(h.session.busy, false); assert.equal(h.session.cleaning, false);
          assert.equal(h.session.state, 'discarded'); assert.equal(h.session.transcript, '');
          assert.equal(h.session.cleanedTranscript, null); assert.equal(h.session.audio, null);
          assert.equal(h.session.cleanupWarning, null); assert.equal(h.session.error, null);
          assert.equal(h.inserts.length, 0); assert.equal(h.live.text, '');
          assert.equal(h.snapshots.at(-1).phase, 'hidden'); assert.equal(h.snapshots.at(-1).text, '');
          const previousId = h.session.sessionId;
          await h.begin();
          assert.notEqual(h.session.sessionId, previousId);
          oldReceive({ kind: 'completed', itemId: 'late', text: 'Old connection completion' });
          await tick();
          assert.equal(h.session.state, 'recording'); assert.equal(h.live.text, provisional);
          assert.equal(h.snapshots.at(-1).phase, 'recording');
          assert.equal(h.snapshots.at(-1).text, provisional); await h.discard();
        });
      }
    }
  }
});

test('pending preview completion cannot block canonical insertion; dispatched paste cannot be cancelled or duplicated', async () => {
  const preview = deferred(), insertion = deferred(), started = deferred();
  const h = harness({ finishPreview: () => preview.promise, insertResult: () => { started.resolve(); return insertion.promise; } });
  await h.begin(); const request = h.release(); await started.promise; await tick();
  assert.equal(h.live.state, 'finishing'); assert.equal(h.session.inserting, true);
  assert.equal(h.session.transcript, canonical); assert.equal(h.session.cleanedTranscript, cleaned);
  assert.equal(h.session.audio, null); assert.equal(h.session.discard(), false);
  assert.equal(h.session.canStart, false); assert.throws(() => h.session.begin());
  await Promise.all([h.session.transcribe(), h.session.retryInsertion(), h.session.retryInsertion()]);
  assert.equal(h.uploads.length, 1); assert.equal(h.cleanupCalls, 1); assert.equal(h.inserts.length, 1);
  insertion.resolve(paste); await request; await tick();
  assert.equal(h.session.state, 'inserted'); assert.equal(h.snapshots.at(-1).phase, 'hidden');
  preview.resolve(); await tick();
  assert.equal(h.live.state, 'completed'); assert.equal(h.snapshots.at(-1).phase, 'hidden');
  await h.discard();
});

test('delayed native preview delivery followed by final failure and cancellation ends hidden with empty recovery values', async () => {
  const send = deferred(), final = deferred(), started = deferred();
  const h = harness({ sendOverlay: snapshot => snapshot.text ? send.promise : undefined,
    finalResult: () => { started.resolve(); return final.promise; } });
  await h.begin(); const request = h.release(); await started.promise;
  // The preview update is still crossing native IPC while recording stops.
  await h.discard(); final.reject('transcription_network_failed'); send.resolve();
  await request; await tick();
  assert.equal(h.session.state, 'discarded'); assert.equal(h.session.audio, null);
  assert.equal(h.session.transcript, ''); assert.equal(h.live.text, '');
  assert.equal(h.inserts.length, 0); assert.equal(h.snapshots.at(-1).phase, 'hidden');
  assert.equal(h.snapshots.at(-1).text, '');
  assert.ok(h.snapshots.every((snapshot, index) => index === 0 || snapshot.revision > h.snapshots[index - 1].revision));
});

test('malformed canonical IPC results retain the original WAV and provisional recovery until an exact-audio retry succeeds', async () => {
  // Invalid canonical text must not become the only retained source after audio
  // release: native insertion/Copy cannot use NUL or >1 MiB UTF-8 text.
  for (const invalid of [{ text: 'not a string' }, 'bad\0canonical', '😀'.repeat(262145)]) {
    const h = harness({ cleanup: 'bypass', finalResult: attempt => attempt === 1 ? invalid : canonical });
    await h.begin(); h.receive({ kind: 'error', code: 'live_disconnected' });
    await h.release(); await tick();
    assert.equal(h.session.state, 'failed'); assert.equal(h.session.error, 'transcription_response_invalid');
    assert.equal(h.session.audio, h.original); assert.equal(h.session.transcript, '');
    assert.equal(h.live.text, provisional); assert.equal(h.releases, 0);
    assert.equal(h.inserts.length, 0); assert.equal(h.cleanupCalls, 0);
    assert.equal(h.snapshots.at(-1).phase, 'error'); assert.equal(h.snapshots.at(-1).text, provisional);
    await Promise.all([h.session.transcribe(), h.session.transcribe()]); await tick();
    const bytes = new Uint8Array(await h.original.arrayBuffer());
    assert.deepEqual(h.uploads, [bytes, bytes]);
    assert.equal(h.session.transcript, canonical); assert.equal(h.session.state, 'inserted');
    assert.equal(h.session.audio, null); assert.equal(h.releases, 1);
    assert.deepEqual(h.inserts, [{ id: h.captures[0], text: canonical }]);
    assert.equal(h.live.text, provisional); assert.equal(h.snapshots.at(-1).phase, 'hidden');
    await h.discard();
  }
});
