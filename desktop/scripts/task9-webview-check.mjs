// Development integration check: two real WebViews, native overlay IPC/windows,
// synthetic microphone and shortcut replay. Default provider seams are local.
// --live explicitly opts into uploading fixed synthetic speech with the saved key.
// Never print snapshots, transcripts, provider errors or credential values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const [operation = 'check', ...flags] = process.argv.slice(2);
const liveRun = flags.includes('--live');
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
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Check timed out')); }, 20000);
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
async function waitFor(page, expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await page.evaluate(expression)) return; await pause(75); }
  throw Error('Expected state did not appear');
}
const snapshotExpression = `(async () => {
  const { invoke } = await import('/node_modules/.vite/deps/@tauri-apps_api_core.js');
  return invoke('overlay_snapshot');
})()`;
async function capture(name) {
  // Only this verified synthetic test app is captured; files are ignored QA output.
  const { data } = await overlay.command('Page.captureScreenshot', { format: 'png' });
  await mkdir('src-tauri/target/task9', { recursive: true });
  await writeFile(`src-tauri/target/task9/${name}.png`, Buffer.from(data, 'base64'));
}
async function checkView() {
  await waitFor(overlay, `document.querySelector('#overlay-label').textContent === 'Provisional' && document.querySelector('#overlay-text').textContent.length > 0`);
  const snapshot = await main.evaluate(snapshotExpression);
  // Do not attach dictated content to assertion failure output.
  assert.ok(snapshot.preview !== 'off' && snapshot.text.length > 0 && snapshot.text.length <= 2048);
  const view = await overlay.evaluate(`(() => ({
    text: document.querySelector('#overlay-text').textContent,
    phase: document.querySelector('#overlay').dataset.phase,
    label: document.querySelector('#overlay-label').textContent,
    contained: document.querySelector('#overlay').scrollHeight === document.querySelector('#overlay').clientHeight,
    tailVisible: document.querySelector('#overlay-text').scrollTop + document.querySelector('#overlay-text').clientHeight >= document.querySelector('#overlay-text').scrollHeight - 2,
    injectedMarkup: !!document.querySelector('#overlay-text img')
  }))()`);
  assert.ok(view.text === snapshot.text && view.phase === snapshot.phase && view.label === 'Provisional');
  assert.ok(view.contained && view.tailVisible && !view.injectedMarkup);
  return { characters: snapshot.text.length, preview: snapshot.preview, hasGap: snapshot.hasGap };
}
try {
  if (operation === 'prepare') {
    // The Task 8 setup captures the exact Vite Channel module instance. Keep
    // its local final-STT fixture; live probe mode never invokes final STT.
    const helper = ['scripts/task8-webview-check.mjs', 'prepare', 'success'];
    const result = spawnSync(process.execPath, helper, { encoding: 'utf8', env: process.env });
    if (result.status !== 0) throw Error('Synthetic setup failed');
    await main.evaluate(`(async () => {
      if (window.__task9Mode && window.__task9Mode !== '${liveRun ? 'live' : 'local'}') throw Error('Restart before changing provider mode');
      window.__task9Mode = '${liveRun ? 'live' : 'local'}';
      ${!liveRun ? `
      const transport = (await import('/src/liveTransport.ts')).nativeStreamingSTT;
      transport.start = async (id, receive) => {
        window.__task9Receive = event => receive({streamId:id, ...event});
        window.__task9Receive({kind:'ready'});
      };
      transport.append = async () => {};
      transport.finish = async () => { window.__task9Receive({kind:'closed'}); };
      transport.cancel = async () => {};
      ` : ''}
      document.querySelector('#hotkey-action').value = 'live';
      document.querySelector('#live-enabled').checked = true;
    })()`);
    console.log(JSON.stringify({ prepared: true, mode: liveRun ? 'live' : 'local' }));
  } else if (operation === 'check') {
    await main.evaluate(`(() => {
      if (window.__task9Mode !== '${liveRun ? 'live' : 'local'}') throw Error('Run matching prepare first');
      if (!['idle','discarded'].includes(document.querySelector('#session-state').textContent)) throw Error('Discard first');
      window.__task8Shortcut({state:'Pressed',shortcut:'Ctrl+Alt+F10'});
    })()`);
    await waitFor(main, `document.querySelector('#live-status').textContent.startsWith('Receiving')`);
    await pause(500);
    if (!liveRun) await main.evaluate(`window.__task9Receive({kind:'delta',itemId:'one',text:${JSON.stringify('你好 😀 Live words are provisional.\n<img src=x onerror=alert(1)>')}})`);
    await waitFor(main, `document.querySelector('#live-transcript').value.trim().length > 0`);
    await pause(200);
    const initial = await checkView();
    assert.equal(initial.preview, 'listening');
    assert.ok(await main.evaluate(`document.querySelector('#session-state').textContent === 'recording' && !document.querySelector('#transcript').value`));
    await capture(liveRun ? 'live-listening' : 'local-listening');
    if (!liveRun) {
      await main.evaluate(`window.__task9Receive({kind:'delta',itemId:'one',text:${JSON.stringify('\n' + 'Technical_identifier 你好 😀 '.repeat(160) + '\nLatest words remain visible.')}})`);
      await pause(200); const long = await checkView(); assert.ok(long.characters >= 2047);
      await capture('local-long');
      await main.evaluate(`window.__task9Receive({kind:'error',code:'live_disconnected'})`);
      await waitFor(overlay, `document.querySelector('#overlay').dataset.warning === 'true' && document.querySelector('#overlay-title').textContent.includes('preview unavailable')`);
      assert.ok(await main.evaluate(`document.querySelector('#session-state').textContent === 'recording'`));
      await capture('local-failure');
      await main.evaluate(`document.querySelector('#live-reconnect').click()`);
      await waitFor(main, `document.querySelector('#live-status').textContent.startsWith('Receiving')`);
      await main.evaluate(`window.__task9Receive({kind:'delta',itemId:'two',text:'Words after reconnect.'})`);
      await waitFor(overlay, `document.querySelector('#overlay-hint').textContent.includes('gap')`);
      await pause(150); assert.equal((await checkView()).hasGap, true);
    }
    await main.evaluate(`window.__task8Shortcut({state:'Released',shortcut:'Ctrl+Alt+F10'})`);
    await waitFor(main, `document.querySelector('#session-state').textContent === 'ready' && !document.querySelector('#recording-playback').hidden`);
    assert.ok(await main.evaluate(`!document.querySelector('#transcript').value`));
    await main.evaluate(`document.querySelector('#discard-transcription').click()`);
    await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'hidden' && document.querySelector('#overlay-text').textContent === ''`);
    const cleared = await main.evaluate(snapshotExpression);
    assert.ok(cleared.phase === 'hidden' && cleared.text === '' && cleared.preview === 'off');
    // A new cancelled session cannot be revived by old connection callbacks.
    await main.evaluate(`window.__task8Shortcut({state:'Pressed',shortcut:'Ctrl+Alt+F10'})`);
    await pause(350);
    await main.evaluate(`document.querySelector('#discard-transcription').click(); ${!liveRun ? `window.__task9Receive({kind:'delta',itemId:'late',text:'Late words must stay hidden.'});` : ''}`);
    await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'hidden' && document.querySelector('#overlay-text').textContent === ''`);
    await waitFor(main, `document.querySelector('#session-state').textContent === 'discarded' && document.querySelector('#recording-playback').hidden`);
    if (!liveRun) {
      // Normal dictate mode still owns the destination. Pause final STT and
      // cancel before its result so this fixture never dispatches paste.
      await main.evaluate(`window.__task8Mode = 'slow'; document.querySelector('#hotkey-action').value = 'record'; window.__task8Shortcut({state:'Pressed',shortcut:'Ctrl+Alt+F10'})`);
      await waitFor(main, `document.querySelector('#live-status').textContent.startsWith('Receiving')`);
      await pause(300);
      await main.evaluate(`window.__task9Receive({kind:'delta',itemId:'processing',text:'Provisional words while finalizing.'}); window.__task8Shortcut({state:'Released',shortcut:'Ctrl+Alt+F10'})`);
      await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'processing' && document.querySelector('#overlay-label').textContent === 'Provisional'`);
      assert.equal((await checkView()).preview, 'completed');
      await capture('local-processing');
      await main.evaluate(`document.querySelector('#discard-transcription').click(); window.__task8Resolve?.()`);
      await waitFor(main, `document.querySelector('#session-state').textContent === 'discarded' && document.querySelector('#recording-playback').hidden`);
      await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'hidden' && document.querySelector('#overlay-text').textContent === ''`);
      assert.ok(await main.evaluate(`!document.querySelector('#transcript').value`));
      // Disabling the preview for the next session cannot show the old words.
      await main.evaluate(`document.querySelector('#hotkey-action').value = 'live'; document.querySelector('#live-enabled').checked = false; window.__task8Shortcut({state:'Pressed',shortcut:'Ctrl+Alt+F10'})`);
      await waitFor(overlay, `document.querySelector('#overlay').dataset.phase === 'recording' && document.querySelector('#overlay-label').textContent === 'BYOK'`);
      assert.ok((await main.evaluate(snapshotExpression)).text === '');
      await main.evaluate(`document.querySelector('#discard-transcription').click(); document.querySelector('#live-enabled').checked = true`);
      await waitFor(main, `document.querySelector('#session-state').textContent === 'discarded' && document.querySelector('#recording-playback').hidden`);
      const rejected = await main.evaluate(`(async () => {
        const { invoke } = await import('/node_modules/.vite/deps/@tauri-apps_api_core.js');
        const before = await invoke('overlay_snapshot');
        let denied = false;
        try { await invoke('update_overlay', { snapshot: {...before, revision:before.revision + 1, phase:'recording', preview:'listening', text:'x'.repeat(2049)} }); }
        catch { denied = true; }
        const after = await invoke('overlay_snapshot');
        return denied && after.revision === before.revision && after.phase === 'hidden' && after.text === '';
      })()`);
      assert.ok(rejected);
    }
    console.log(JSON.stringify({ mode: liveRun ? 'live' : 'local', wordsBeforeRelease: true, boundedLayout: true,
      noCanonicalOrPaste: true, releasedAudioRetained: true, discardClearedBothWebViews: true, cancellationPassed: true,
      failureAndReconnect: liveRun ? 'not exercised' : 'passed', processingCancellationAndPreviewOff: liveRun ? 'not exercised' : 'passed',
      initialCharacters: initial.characters }));
  } else {
    const snapshot = await main.evaluate(snapshotExpression);
    console.log(JSON.stringify({ phase: snapshot.phase, preview: snapshot.preview, characters: snapshot.text.length }));
  }
} finally { main.socket.close(); overlay.socket.close(); }
