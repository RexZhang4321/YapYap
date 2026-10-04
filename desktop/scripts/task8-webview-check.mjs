// Local-only Task 8 check. Uses synthetic capture, a fixed fake FinalSTT, and
// real native destination/overlay/insertion commands. No provider calls.
const [operation = 'status', mode = 'success'] = process.argv.slice(2);
if (!['prepare', 'press', 'release', 'cancel', 'complete', 'retry', 'status', 'security'].includes(operation)) throw Error('Unknown operation');
const port = Number(process.env.TASK6_CDP_PORT || 9223);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.url === (operation === 'security' ? 'http://localhost:1420/overlay.html' : 'http://localhost:1420/'));
if (!target) throw Error('Development WebView not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0; const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data), item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id); clearTimeout(item.timeout);
  message.error ? item.reject(Error('Debugging command failed')) : item.resolve(message.result);
};
async function evaluate(expression) {
  const result = await new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error('Check timed out')); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (result.exceptionDetails) throw Error('App-side check failed');
  return result.result.value;
}
try {
  if (operation === 'prepare') {
    if (!['success', 'failure', 'slow'].includes(mode)) throw Error('Unknown fixture mode');
    await evaluate(`(async () => {
      const inputs = await navigator.mediaDevices.enumerateDevices();
      if (!inputs.some(d => d.kind === 'audioinput' && d.label.startsWith('Fake '))) throw Error('Synthetic microphone required');
      if (!['idle','discarded'].includes(document.querySelector('#session-state').textContent)) throw Error('Discard the previous session first');
      if (!window.__task8Shortcut) {
        // Import the exact module URL used by main, including Vite's cache key.
        // A second core module has a different Channel prototype.
        const source = await (await fetch('/src/main.ts')).text();
        const url = source.match(/from "([^"]*@tauri-apps_api_core[^\"]*)"/)[1];
        const core = await import(url);
        const descriptor = Object.getOwnPropertyDescriptor(core.Channel.prototype, 'onmessage');
        Object.defineProperty(core.Channel.prototype, 'onmessage', { ...descriptor, set(handler) {
          window.__task8Shortcut = handler; descriptor.set.call(this, handler);
        }});
        try {
          document.querySelector('#shortcut').value = 'Ctrl+Alt+F10';
          document.querySelector('#shortcut-form').requestSubmit();
          const deadline = Date.now() + 5000;
          while (!window.__task8Shortcut && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
        } finally { Object.defineProperty(core.Channel.prototype, 'onmessage', descriptor); }
        if (!window.__task8Shortcut) throw Error('Shortcut callback unavailable');
      }
      document.querySelector('#prepare-microphone').click();
      const deadline = Date.now() + 5000;
      while (!document.querySelector('#recording-status').textContent.startsWith('Microphone ready:') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      if (!document.querySelector('#recording-status').textContent.startsWith('Microphone ready:')) throw Error('Microphone preparation failed');
      const { TranscriptionSession } = await import('/src/transcriptionSession.ts');
      if (!window.__task8Prepared) {
        const transcribe = TranscriptionSession.prototype.transcribe;
        TranscriptionSession.prototype.transcribe = function () {
          this.provider = async () => {
            if (window.__task8Mode === 'failure') throw 'transcription_network_failed';
            if (window.__task8Mode === 'slow') await new Promise(resolve => { window.__task8Resolve = resolve; });
            return 'Task 8 fixed canonical text';
          };
          return transcribe.call(this);
        };
      }
      window.__task8Mode = '${mode}'; window.__task8Prepared = true;
      document.querySelector('#hotkey-action').value = 'record';
      document.querySelector('#live-enabled').checked = false;
    })()`);
  } else if (operation === 'press' || operation === 'release') {
    await evaluate(`(() => {
      if (!window.__task8Prepared) throw Error('Run local-only prepare first');
      window.__task8Shortcut({state:'${operation === 'press' ? 'Pressed' : 'Released'}',shortcut:'Ctrl+Alt+F10'});
    })()`);
  } else if (operation === 'cancel') {
    await evaluate(`document.querySelector('#discard-transcription').click(); window.__task8Resolve?.();`);
  } else if (operation === 'complete') {
    await evaluate(`window.__task8Resolve?.()`);
  } else if (operation === 'retry') {
    await evaluate(`window.__task8Mode = 'success'; document.querySelector('#transcribe-recording').click();`);
  } else if (operation === 'security') {
    console.log(JSON.stringify(await evaluate(`(async () => {
      const { invoke } = await import('/node_modules/.vite/deps/@tauri-apps_api_core.js');
      let denied = false;
      try { await invoke('has_api_key'); } catch { denied = true; }
      return { deniedAppCommands: denied, phase: (await invoke('overlay_snapshot')).phase,
        hasCredentialInput: !!document.querySelector('input'), hasMicrophoneUI: !!document.querySelector('audio') };
    })()`)));
  }
  if (operation !== 'security') console.log(JSON.stringify(await evaluate(`(async () => {
    const { invoke } = await import('/node_modules/.vite/deps/@tauri-apps_api_core.js');
    const snapshot = await invoke('overlay_snapshot');
    return { state: document.querySelector('#session-state').textContent,
      overlay: snapshot, audioRetained: !document.querySelector('#recording-playback').hidden,
      hasTranscript: !!document.querySelector('#transcript').value,
      discardDisabled: document.querySelector('#discard-transcription').disabled,
      fixturePrepared: !!window.__task8Prepared };
  })()`)));
} finally { socket.close(); }
