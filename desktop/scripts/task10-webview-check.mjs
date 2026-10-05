// Repeatable combined-flow check. Local fixtures by default; --live explicitly
// uploads fixed synthetic speech to native live/final STT with the saved key.
// Never print provider output, transcripts, snapshots, errors, or credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const [operation = 'check', ...flags] = process.argv.slice(2);
const real = flags.includes('--live');
if (!['prepare', 'check', 'status'].includes(operation)) throw Error('Unknown operation');
const port = Number(process.env.TASK6_CDP_PORT || 9223);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function connect(url) {
  const target = targets.find(item => item.type === 'page' && item.url === url);
  if (!target) throw Error('Development WebView not found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const pending = new Map();
  socket.onmessage = event => {
    const result = JSON.parse(event.data), item = pending.get(result.id);
    if (!item) return;
    pending.delete(result.id); clearTimeout(item.timer);
    result.error ? item.reject(Error('Debugging command failed')) : item.resolve(result.result);
  };
  async function command(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Check timed out')); }, 55000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return { socket, command, async evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error('App-side check failed');
    return result.result.value;
  } };
}
const main = await connect('http://localhost:1420/');
const overlay = await connect('http://localhost:1420/overlay.html');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await page.evaluate(expression)) return; await pause(75); }
  throw Error('Expected state did not appear');
}
const output = 'src-tauri/target/task10';
let expectedInput = '';
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
async function stage(phase) {
  await mkdir(output, { recursive: true });
  // Only hashes of the fixed synthetic test result; no transcript/audio files.
  await writeFile(`${output}/stage.json`, JSON.stringify({ phase, expectedHash: hash(expectedInput) }));
}
async function screenshot(name) {
  const { data } = await overlay.command('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}/${name}.png`, Buffer.from(data, 'base64'));
}
const state = name => `document.querySelector('#session-state').textContent === '${name}'`;
const shortcut = kind => main.evaluate(`window.__task10Shortcut({state:'${kind}',shortcut:'Ctrl+Alt+F10'})`);
async function discard() {
  await main.evaluate(`document.querySelector('#discard-transcription').click(); window.__task10Resolve?.()`);
  await waitFor(main, `${state('discarded')} && document.querySelector('#recording-playback').hidden`);
  await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'hidden' && !document.querySelector('#overlay-text').textContent`);
}
async function start(mode) {
  await stage('recording');
  await main.evaluate(`window.__task10FinalMode = '${mode}'; window.__task10Audit = [];`);
  await shortcut('Pressed');
  await waitFor(main, `document.querySelector('#live-status').textContent.startsWith('Receiving')`);
  if (!real) await main.evaluate(`window.__task10Receive({kind:'delta',itemId:'one',text:'These live words must never be pasted.'})`);
  await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'recording' && document.querySelector('#overlay-label').textContent === 'Provisional' && !!document.querySelector('#overlay-text').textContent`);
  assert.ok(await main.evaluate(`${state('recording')} && !document.querySelector('#transcript').value`));
  await screenshot(real ? 'real-listening' : `local-${mode}-listening`);
  await pause(real ? 8500 : 650);
}
async function stop() {
  await stage('finalizing');
  await shortcut('Released');
  await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'processing' && document.querySelector('#overlay-title').textContent === 'Finalizing'`);
  await screenshot(real ? 'real-finalizing' : 'local-finalizing');
}
async function audit(count) {
  const result = await main.evaluate(`(() => {
    const rows = window.__task10Audit;
    return { requests:rows.length, wholeAudio:rows.every(r => r.exact && r.durationMatches && r.byteCountMatches),
      retryIdentical:rows.every(r => r.digest === rows[0].digest), duration: rows[0]?.duration };
  })()`);
  assert.equal(result.requests, count); assert.ok(result.wholeAudio && result.retryIdentical);
  assert.ok(result.duration > (real ? 8 : 0.4));
  return result;
}
async function completed() {
  await waitFor(main, state('inserted'));
  assert.ok(await main.evaluate(`document.querySelector('#transcription-status').textContent.startsWith('Completed.') && document.querySelector('#recording-playback').hidden && !!document.querySelector('#transcript').value`));
  await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'hidden' && document.querySelector('#overlay-text').textContent === ''`);
  // Only synthetic output remains in process memory for exact native input checking.
  expectedInput += await main.evaluate(`document.querySelector('#transcript').value`);
  if (!real) assert.ok(await main.evaluate(`window.__taskUi.control('transcript').value === 'Task 10 canonical result. 你好 😀' && document.querySelector('#live-transcript').value !== document.querySelector('#transcript').value`));
  await stage('completed');
}
try {
  if (operation === 'prepare') {
    await main.evaluate(`(async () => {
      if (window.__task8Prepared || window.__task9Mode || window.__task10Prepared) throw Error('Restart before preparing this check');
      window.__taskUi = (await import('/src/ui/store.ts')).ui;
      const inputs = await navigator.mediaDevices.enumerateDevices();
      if (!inputs.some(d => d.kind === 'audioinput' && d.label.startsWith('Fake '))) throw Error('Synthetic microphone required');
      if (!['idle','discarded'].includes(document.querySelector('#session-state').textContent)) throw Error('Discard first');
      const source = await (await fetch('/src/dictationController.ts')).text();
      const url = source.match(/from "([^\"]*@tauri-apps_api_core[^\"]*)"/)[1];
      const core = await import(url);
      const descriptor = Object.getOwnPropertyDescriptor(core.Channel.prototype, 'onmessage');
      Object.defineProperty(core.Channel.prototype, 'onmessage', { ...descriptor, set(handler) {
        window.__task10Shortcut = handler; descriptor.set.call(this, handler);
      }});
      try {
        window.__taskUi.control('shortcut').value = 'Ctrl+Alt+F10';
        document.querySelector('#shortcut-form').requestSubmit();
        const deadline = Date.now() + 5000;
        while (!window.__task10Shortcut && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      } finally { Object.defineProperty(core.Channel.prototype, 'onmessage', descriptor); }
      if (!window.__task10Shortcut) throw Error('Shortcut callback unavailable');
      document.querySelector('#prepare-microphone').click();
      const deadline = Date.now() + 5000;
      while (!document.querySelector('#recording-status').textContent.startsWith('Microphone ready:') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      if (!document.querySelector('#recording-status').textContent.startsWith('Microphone ready:')) throw Error('Microphone preparation failed');
      const { TranscriptionSession } = await import('/src/transcriptionSession.ts');
      const transcribe = TranscriptionSession.prototype.transcribe;
      TranscriptionSession.prototype.transcribe = function () {
        const originalAudio = this.audio;
        this.provider = async bytes => {
          const originalBytes = new Uint8Array(await originalAudio.arrayBuffer());
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const channels = view.getUint16(22, true), rate = view.getUint32(24, true), frames = view.getUint32(40, true) / (channels * 2);
          const duration = frames / rate;
          const displayedDuration = Number(document.querySelector('#recording-metadata').textContent.match(/Duration: ([\\d.]+) s/)[1]);
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2,'0')).join('');
          window.__task10Audit.push({ exact:bytes.length === originalBytes.length && bytes.every((v,i) => v === originalBytes[i]),
            durationMatches:Math.abs(displayedDuration - duration) <= 0.011, byteCountMatches:bytes.length === 44 + frames * channels * 2, digest, duration });
          // Give the real passive WebView enough time to render finalizing.
          await new Promise(r => setTimeout(r, 450));
          ${real ? `return core.invoke('transcribe_recording', bytes);` : `
          if (window.__task10FinalMode === 'failure') throw 'transcription_network_failed';
          if (window.__task10FinalMode === 'slow') await new Promise(resolve => { window.__task10Resolve = resolve; });
          return 'Task 10 canonical result. 你好 😀';`}
        };
        return transcribe.call(this);
      };
      ${!real ? `
      const transport = (await import('/src/liveTransport.ts')).nativeStreamingSTT;
      transport.start = async (id, receive) => { window.__task10Receive = event => receive({streamId:id, ...event}); window.__task10Receive({kind:'ready'}); };
      transport.append = async () => {};
      transport.finish = async () => window.__task10Receive({kind:'closed'});
      transport.cancel = async () => {};
      ` : ''}
      window.__task10Prepared = '${real ? 'real' : 'local'}';
      window.__taskUi.control('hotkey-action').value = 'record'; window.__taskUi.dispatch('hotkey-action', 'change', new Event('change'));
      window.__taskUi.control('live-enabled').checked = true; window.__taskUi.dispatch('live-enabled', 'change', new Event('change'));
      // Task 10 asserts canonical insertion; Task 11 cleanup has separate coverage.
      window.__taskUi.control('cleanup-enabled').checked = false; window.__taskUi.dispatch('cleanup-enabled', 'change', new Event('change'));
    })()`);
    console.log(JSON.stringify({ prepared:true, mode:real ? 'real' : 'local' }));
  } else if (operation === 'check') {
    assert.ok(await main.evaluate(`window.__task10Prepared === '${real ? 'real' : 'local'}' && ['idle','discarded'].includes(document.querySelector('#session-state').textContent)`));
    await start('success');
    if (!real) {
      await main.evaluate(`window.__task10Receive({kind:'error',code:'live_disconnected'})`);
      await waitFor(overlay, `document.querySelector('#overlay-title').textContent.includes('preview unavailable')`);
    }
    await stop(); await completed(); const first = await audit(1);
    await discard();
    if (!real) {
      await start('failure'); await stop();
      await waitFor(main, state('failed'));
      await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'error'`);
      assert.ok(await main.evaluate(`!document.querySelector('#recording-playback').hidden && !document.querySelector('#transcript').value`));
      await screenshot('local-error'); await audit(1);
      await main.evaluate(`window.__task10FinalMode = 'success'; document.querySelector('#transcribe-recording').click()`);
      await completed(); await audit(2); await discard();
      await start('slow'); await stop();
      await waitFor(main, `typeof window.__task10Resolve === 'function'`);
      await discard(); await pause(600);
      assert.ok(await main.evaluate(`${state('discarded')} && !document.querySelector('#transcript').value`));
      await audit(1);
    }
    await stage('done');
    console.log(JSON.stringify({ mode:real ? 'real' : 'local', wordsBeforeRelease:true, canonicalOnlyInsertion:true,
      completeOriginalWav:true, originalDurationSeconds:Number(first.duration.toFixed(2)), successAutoHidden:true,
      successReleasedAudio:true, completionShown:true, previewFailureIndependent:!real,
      finalFailureRetriedIdenticalAudio:!real, lateFinalResponseSuppressed:!real }));
  } else {
    const result = await main.evaluate(`({ state:document.querySelector('#session-state').textContent,
      hasCanonical:!!document.querySelector('#transcript').value, audioRetained:!document.querySelector('#recording-playback').hidden })`);
    console.log(JSON.stringify(result));
  }
} finally { main.socket.close(); overlay.socket.close(); }
