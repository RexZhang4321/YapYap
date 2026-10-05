// Opt-in synthetic-microphone integration check. No credential getters, real
// microphone recordings, transcript printing, or target-app insertion.
import { spawnSync } from 'node:child_process';
const [operation = 'status', ...flags] = process.argv.slice(2);
if (!['prepare', 'record', 'interrupt', 'reconnect', 'cancel', 'retry', 'discard', 'status'].includes(operation)) throw new Error('Unknown check operation');
if (['record', 'interrupt', 'reconnect', 'cancel', 'retry'].includes(operation) && !flags.includes('--live')) {
  throw new Error('This check uploads synthetic audio using the saved key; pass --live explicitly');
}
if (operation === 'prepare') {
  const setup = spawnSync(process.execPath, ['scripts/task6-webview-check.mjs', 'prepare'], { encoding: 'utf8', env: process.env });
  if (setup.status !== 0) throw new Error('Synthetic microphone/shortcut preparation failed');
}
const port = Number(process.env.TASK6_CDP_PORT || 9223);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.url === 'http://localhost:1420/');
if (!target) throw new Error('Development app page not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const result = JSON.parse(event.data), item = pending.get(result.id);
  if (!item) return;
  pending.delete(result.id); clearTimeout(item.timeout);
  result.error ? item.reject(new Error('App debugging command failed')) : item.resolve(result.result);
};
async function evaluate(expression) {
  const result = await new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('App check timed out')); }, 55_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (result.exceptionDetails) throw new Error('App-side check failed; inspect its visible status');
  return result.result.value;
}
try {
  if (operation === 'prepare') {
    await evaluate(`(async () => {
      if (!window.__task6Synthetic) throw new Error('Synthetic microphone required');
      const transport = (await import('/src/liveTransport.ts')).nativeStreamingSTT;
      if (!window.__task7Prepared) {
        const start = transport.start;
        transport.start = async (id, receive) => {
          window.__task7Stream = id;
          window.__task7Receive = receive;
          await start(id, event => {
            if (event.kind === 'delta') {
              window.__task7Metrics.deltas++;
              if (!window.__task7Released && event.text?.trim()) window.__task7Metrics.wordsBeforeRelease = true;
            }
            if (event.kind === 'completed') window.__task7Metrics.completions++;
            receive(event);
          });
        };
      }
      window.__task7Metrics = {deltas:0,completions:0,wordsBeforeRelease:false};
      window.__task7Prepared = true;
      window.__taskUi.control('hotkey-action').value = 'live'; window.__taskUi.dispatch('hotkey-action', 'change', new Event('change'));
      window.__taskUi.control('live-enabled').checked = true; window.__taskUi.dispatch('live-enabled', 'change', new Event('change'));
    })()`);
  } else if (['record', 'interrupt', 'reconnect', 'cancel'].includes(operation)) {
    await evaluate(`(async () => {
      if (!window.__task7Prepared || !window.__task6Synthetic) throw new Error('Run prepare with the fake microphone first');
      if (!['idle','discarded'].includes(document.querySelector('#session-state').textContent)) throw new Error('Discard previous session first');
      window.__task7Metrics = {deltas:0,completions:0,wordsBeforeRelease:false};
      window.__task7Released = false;
      window.__taskUi.control('hotkey-action').value = 'live'; window.__taskUi.dispatch('hotkey-action', 'change', new Event('change'));
      const pause = ms => new Promise(r => setTimeout(r, ms));
      window.__task6Shortcut({state:'Pressed',shortcut:'Ctrl+Alt+F9'});
      await pause(${operation === 'cancel' ? (flags.includes('--after-words') ? 3500 : 300) : operation === 'record' ? 8000 : 3500});
      ${['interrupt', 'reconnect'].includes(operation) ? `
        // Terminate the actual native socket, then inject the fixed disconnect
        // notification at the transport seam. This is not a physical network outage.
        const core = await import('/node_modules/.vite/deps/@tauri-apps_api_core.js');
        window.__task7Receive({streamId:window.__task7Stream,kind:'error',code:'live_disconnected'});
        window.__task7Metrics.failureVisible = document.querySelector('#live-status').textContent.includes('disconnected');
        await core.invoke('cancel_live_stream', {streamId:window.__task7Stream});
        ${operation === 'reconnect' ? `document.querySelector('#live-reconnect').click();` : ''}
        await pause(6000);
      ` : ''}
      window.__task7Released = true;
      ${operation === 'cancel' ? `document.querySelector('#discard-transcription').click();` : `window.__task6Shortcut({state:'Released',shortcut:'Ctrl+Alt+F9'});`}
      const deadline = Date.now()+15000;
      while (Date.now()<deadline && (
        document.querySelector('#session-state').textContent === 'recording'
        || document.querySelector('#live-status').textContent.startsWith('Finishing')
        || (document.querySelector('#session-state').textContent === 'discarded' && !document.querySelector('#recording-playback').hidden)
      )) await pause(100);
    })()`);
  } else if (operation === 'retry') {
    await evaluate(`(async () => {
      if (!window.__task7Prepared || !window.__task6Synthetic) throw new Error('Synthetic microphone required');
      document.querySelector('#transcribe-recording').click();
      const deadline=Date.now()+40000;
      while (Date.now()<deadline && document.querySelector('#session-state').textContent === 'finalizing') await new Promise(r=>setTimeout(r,100));
    })()`);
  } else if (operation === 'discard') {
    await evaluate(`document.querySelector('#discard-transcription').click()`);
  }
  console.log(JSON.stringify(await evaluate(`(() => ({
    state:document.querySelector('#session-state').textContent,
    liveStatus:document.querySelector('#live-status').textContent,
    latency:document.querySelector('#live-latency').textContent,
    metrics:window.__task7Metrics,
    liveCharacters:document.querySelector('#live-transcript').value.length,
    liveRecognizedSyntheticPhrase:document.querySelector('#live-transcript').value.toLowerCase().includes('hello from the dictation test'),
    hasGap:document.querySelector('#live-status').textContent.includes('connection gap'),
    canonicalCharacters:document.querySelector('#transcript').value.length,
    canonicalRecognizedSyntheticPhrase:document.querySelector('#transcript').value.toLowerCase().includes('hello from the dictation test'),
    audioRetained:!document.querySelector('#recording-playback').hidden,
    recordingMetadata:document.querySelector('#recording-metadata').textContent,
    canonicalStatus:document.querySelector('#transcription-status').textContent
  }))()`), null, 2));
} finally { socket.close(); }
