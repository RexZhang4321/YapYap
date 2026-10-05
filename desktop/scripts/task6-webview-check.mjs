// Opt-in development integration check. Requires Node 22+, a running Vite/Tauri
// app with WebView2 remote debugging and a synthetic fake microphone. Does not
// retrieve credentials or write recordings/transcripts. Shortcut events are
// replayed through the registered handler; Windows key delivery is a separate
// real-shortcut check. Keep the intended blank editor focused during `record`.
const [operation = "status", ...flags] = process.argv.slice(2);
if (!["prepare", "record", "status", "discard"].includes(operation)) throw new Error("Unknown check operation");
if (operation === "record" && !flags.includes("--live")) {
  throw new Error("record uploads synthetic audio to OpenAI using the saved key; pass --live explicitly");
}
const port = Number(process.env.TASK6_CDP_PORT || 9223);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === "page" && item.url === "http://localhost:1420/");
if (!target) throw new Error("The development app page was not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const result = JSON.parse(event.data);
  const item = pending.get(result.id);
  if (!item) return;
  pending.delete(result.id);
  clearTimeout(item.timeout);
  result.error ? item.reject(new Error("App debugging command failed")) : item.resolve(result.result);
};
async function evaluate(expression) {
  const result = await new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error("App check timed out")); }, 55_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: {
      expression, awaitPromise: true, returnByValue: true,
    } }));
  });
  if (result.exceptionDetails) throw new Error("App-side check failed; inspect its visible status");
  return result.result.value;
}
const statusExpression = `(() => ({
  state: document.querySelector('#session-state').textContent,
  status: document.querySelector('#transcription-status').textContent,
  hasTranscript: !!document.querySelector('#transcript').value,
  syntheticSpeechRecognized: document.querySelector('#transcript').value.toLowerCase().includes('hello from the dictation test'),
  audioReleased: document.querySelector('#recording-playback').hidden,
  microphoneStatus: document.querySelector('#recording-status').textContent
}))()`;
try {
  if (operation === "prepare") {
    await evaluate(`(async () => {
      window.__taskUi = (await import('/src/ui/store.ts')).ui;
      const inputs = await navigator.mediaDevices.enumerateDevices();
      if (!inputs.some(d => d.kind === 'audioinput' && d.label.startsWith('Fake '))) throw new Error('Fake microphone required');
      if (!['idle','discarded'].includes(document.querySelector('#session-state').textContent)) throw new Error('Discard the current session first');
      const core = await import('/node_modules/.vite/deps/@tauri-apps_api_core.js');
      const descriptor = Object.getOwnPropertyDescriptor(core.Channel.prototype, 'onmessage');
      Object.defineProperty(core.Channel.prototype, 'onmessage', { ...descriptor, set(handler) {
        window.__task6Shortcut = handler; descriptor.set.call(this, handler);
      }});
      for (const shortcut of ['Ctrl+Alt+F8','Ctrl+Alt+F9']) {
        try { await core.invoke('plugin:global-shortcut|unregister', {shortcuts:[shortcut]}); }
        catch { /* A binding may already have been removed during a dev reload. */ }
      }
      window.__taskUi.control('shortcut').value = 'Ctrl+Alt+F9';
      document.querySelector('#shortcut-form').requestSubmit();
      document.querySelector('#prepare-microphone').click();
      const deadline = Date.now()+10000;
      while (Date.now()<deadline && (!window.__task6Shortcut || !document.querySelector('#recording-status').textContent.startsWith('Microphone ready:'))) {
        await new Promise(r=>setTimeout(r,100));
      }
      if (!window.__task6Shortcut) throw new Error('No shortcut callback registered');
      Object.defineProperty(core.Channel.prototype, 'onmessage', descriptor);
      window.__task6Synthetic = true;
    })()`);
  } else if (operation === "record") {
    await evaluate(`(async () => {
      if (typeof window.__task6Shortcut !== 'function') throw new Error('Run prepare first');
      if (!window.__task6Synthetic) throw new Error('Run prepare with the fake microphone first');
      window.__task6Shortcut({state:'Pressed',shortcut:'Ctrl+Alt+F9'});
      await new Promise(r=>setTimeout(r,8000));
      window.__task6Shortcut({state:'Released',shortcut:'Ctrl+Alt+F9'});
      const deadline=Date.now()+40000;
      while(Date.now()<deadline && ['recording','ready','finalizing'].includes(document.querySelector('#session-state').textContent)) {
        await new Promise(r=>setTimeout(r,250));
      }
    })()`);
  } else if (operation === "discard") {
    await evaluate("document.querySelector('#discard-transcription').click()");
  }
  console.log(JSON.stringify(await evaluate(statusExpression), null, 2));
} finally { socket.close(); }
