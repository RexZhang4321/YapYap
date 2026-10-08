import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { platformAlias } from "../platform.config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const indexPath = resolve(root, "index.html");
const canonicalText = "Original words: send 42 to user_id\n你好 😀 https://example.test/a?q=2";
const cleanedText = "Send 42 to user_id.\n你好 😀 https://example.test/a?q=2";
const provisionalText = "Provisional, possibly incomplete words 17 😀";

const bridge = `
<script>
(() => {
  const callbacks = new Map();
  let callbackId = 0;
  const handlers = new Map();
  const gates = new Map();
  const state = { hasKey: new URLSearchParams(location.search).get("key") !== "missing", transcription: "immediate", cleanup: "pending", lastPendingName: "", copies: [], insertions: [], calls: [] };
  const renderSnapshot = () => {
    const target = document.querySelector("#fixture-snapshot");
    const session = window.__recoveryFixture?.transcription;
    if (!target || !session) return;
    const value = JSON.stringify({
      state: session.state, busy: session.busy, stalled: session.stalled, cleaning: session.cleaning,
      discarded: session.discarded, transcript: session.transcript, cleanedTranscript: session.cleanedTranscript,
      audioRetained: session.audio !== null, canStart: session.canStart, error: session.error,
      copies: state.copies, insertions: state.insertions,
      commands: state.calls.map(item => item.command),
    }, null, 2);
    if (target.textContent !== value) target.textContent = value;
  };
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const gate = name => {
    if (!gates.has(name)) gates.set(name, deferred());
    return gates.get(name);
  };
  window.__fixtureIPC = {
    state,
    resetCalls() { state.copies.length = 0; state.insertions.length = 0; state.calls.length = 0; state.lastPendingName = ""; gates.clear(); },
    resolve(name, value) { gate(name).resolve(value); },
    reject(name, error) { gate(name).reject(error); },
    emitLive(event) {
      const start = state.calls.findLast(call => call.command === "start_live_stream");
      if (!start) throw new Error("No live stream started.");
      start.args.events.onmessage({ streamId: start.args.streamId, ...event });
    },
    snapshot() {
      const session = window.__recoveryFixture?.transcription;
      return {
        session: session ? {
          sessionId: session.sessionId, state: session.state, busy: session.busy, stalled: session.stalled,
          cleaning: session.cleaning, discarded: session.discarded, transcript: session.transcript,
          cleanedTranscript: session.cleanedTranscript, audioRetained: session.audio !== null,
          canStart: session.canStart, error: session.error,
        } : null,
        copies: state.copies.map(item => ({ ...item })),
        insertions: state.insertions.map(item => ({ ...item })),
        commands: state.calls.map(item => item.command),
      };
    },
    render: renderSnapshot,
  };
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback(callback) {
      const id = String(++callbackId);
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id) { callbacks.delete(String(id)); },
    invoke(command, args = {}) {
      state.calls.push({ command, args: command === "save_api_key" ? {} : args });
      if (command === "plugin:global-shortcut|register") {
        for (const shortcut of args.shortcuts ?? []) handlers.set(shortcut, args.handler);
        return Promise.resolve();
      }
      if (command === "plugin:global-shortcut|unregister") {
        for (const shortcut of args.shortcuts ?? []) handlers.delete(shortcut);
        return Promise.resolve();
      }
      if (command === "has_api_key") return Promise.resolve(state.hasKey);
      if (command === "save_api_key") { state.hasKey = true; return Promise.resolve(); }
      if (command === "delete_api_key") { state.hasKey = false; return Promise.resolve(); }
      if (command === "has_clipboard_backup") return Promise.resolve(false);
      if (command === "claim_overlay") return Promise.resolve({ epoch: 1, revision: 0 });
      if (command === "update_overlay" || command === "discard_dictation_target") return Promise.resolve();
      if (command === "transcribe_recording") {
        if (state.transcription === "pending") { state.lastPendingName = "transcription"; return gate("transcription").promise; }
        if (state.transcription === "error") return Promise.reject("transcription_network_failed");
        return Promise.resolve(${JSON.stringify(canonicalText)});
      }
      if (command === "cleanup_transcript") {
        if (state.cleanup === "pending") { state.lastPendingName = "cleanup"; return gate("cleanup").promise; }
        if (state.cleanup === "error") return Promise.reject("cleanup_network_failed");
        return Promise.resolve(${JSON.stringify(cleanedText)});
      }
      if (command === "copy_dictation_text") {
        state.copies.push({ text: args.text, withoutBackup: args.withoutBackup });
        return Promise.resolve("Fixture clipboard copy complete.");
      }
      if (command === "insert_dictation_text") {
        state.insertions.push({ sessionId: args.sessionId, text: args.text });
        return Promise.resolve(state.insertion ?? { pasteAttempted: true, pasteSent: true, clipboardRestored: true, message: "Fixture insertion" });
      }
      if (command === "list_audio_inputs") return Promise.resolve([]);
      if (command === "finish_live_stream" && state.live === "immediate") {
        setTimeout(() => {
          window.__fixtureIPC.emitLive({ kind: "completed", itemId: "fixture-item", text: ${JSON.stringify(provisionalText)} });
          window.__fixtureIPC.emitLive({ kind: "closed" });
        }, 0);
      }
      if (command === "start_live_stream" || command === "append_live_audio" || command === "finish_live_stream" || command === "cancel_live_stream") return Promise.resolve();
      return Promise.resolve();
    },
  };
  const fixtureTrack = {
    label: "Fixture microphone", readyState: "live", muted: false,
    getSettings: () => ({ deviceId: "fixture-mic", sampleRate: 48000 }),
    stop() { this.readyState = "ended"; }, addEventListener() {}, removeEventListener() {},
  };
  const fixtureStream = { getAudioTracks: () => [fixtureTrack], getTracks: () => [fixtureTrack] };
  try {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      enumerateDevices: async () => [{ kind: "audioinput", deviceId: "fixture-mic", label: "Fixture microphone" }],
      getUserMedia: async () => fixtureStream,
      addEventListener() {},
    } });
  } catch { /* This fixture never requests real microphone access. */ }
  new MutationObserver(renderSnapshot).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener("recovery-fixture-ready", renderSnapshot);
})();
</script>`;

const controls = `
<details id="fixture-controls" style="position:relative;z-index:1000;margin:8px auto;max-width:760px;padding:8px 12px;border:1px solid #808080;border-radius:8px;background:#f4f5f7;color:#17202a">
  <summary>Local recovery fixture controls</summary>
  <p>Deterministic fixture: provider, clipboard, keyboard shortcut, and microphone IPC are stubbed.</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px">
    <button type="button" id="fixture-cleanup">Seed cleanup stall</button>
    <button type="button" id="fixture-final">Seed final transcription stall</button>
    <button type="button" id="fixture-error">Seed transcription error</button>
    <button type="button" id="fixture-late">Resolve pending provider</button>
  </div>
  <p id="fixture-status" role="status">Ready.</p>
  <pre id="fixture-snapshot" aria-label="Fixture session snapshot">Waiting for app fixture hook.</pre>
</details>
<script>
(() => {
  const status = document.querySelector("#fixture-status");
  const run = name => {
    try {
      const action = window.__recoveryFixture?.[name];
      if (!action) throw new Error("App fixture hook is not ready.");
      const result = action();
      Promise.resolve(result).catch(error => { status.textContent = "Fixture failed: " + String(error); });
      status.textContent = "Seeded: " + name;
    } catch (error) { status.textContent = "Fixture failed: " + String(error); }
  };
  document.querySelector("#fixture-cleanup").addEventListener("click", () => run("startCleanupStall"));
  document.querySelector("#fixture-final").addEventListener("click", () => run("startFinalStall"));
  document.querySelector("#fixture-error").addEventListener("click", () => run("startProviderError"));
  document.querySelector("#fixture-late").addEventListener("click", () => {
    const pendingName = window.__fixtureIPC.state.lastPendingName;
    if (pendingName) window.__fixtureIPC.resolve(pendingName, pendingName === "cleanup" ? ${JSON.stringify(cleanedText)} : ${JSON.stringify(canonicalText)});
    status.textContent = "Resolved the old pending provider response.";
  });
})();
</script>`;

const appendedHooks = `
Object.assign(window, { __recoveryFixture: {
  transcription, live, recorder, application: app,
  shortcut: state => onShortcut({ state, shortcut: shortcutBinding.active }),
  setPreviewSession: sessionId => { app.updateRecovery({ livePreviewSession: sessionId }); },
  reset() {
    if (transcription.busy || transcription.hasResult || transcription.state === "failed") transcription.discard();
    live.cancel(); app.updateRecovery({ livePreviewSession: "" });
    window.__fixtureIPC.resetCalls();
    window.__fixtureIPC.state.cleanup = "pending";
  },
  startCleanupStall() {
    window.__recoveryFixture.reset();
    window.__fixtureIPC.state.transcription = "immediate";
    window.__fixtureIPC.state.cleanup = "pending";
    transcription.begin(false, true);
    transcription.capture(new Blob([new Uint8Array(128)]));
    void transcription.transcribe();
    setTimeout(() => { if (transcription.busy) { transcription.stalled = true; showState(); } }, 50);
    return true;
  },
  startFinalStall() {
    window.__recoveryFixture.reset();
    window.__fixtureIPC.state.transcription = "pending";
    transcription.begin(false, false);
    app.updateRecovery({ livePreviewSession: transcription.sessionId });
    live.state = "listening";
    live.text = ${JSON.stringify(provisionalText)};
    showLiveState();
    transcription.capture(new Blob([new Uint8Array(128)]));
    void transcription.transcribe();
    setTimeout(() => { if (transcription.busy) { transcription.stalled = true; showState(); } }, 50);
    return true;
  },
  startProviderError() {
    window.__recoveryFixture.reset();
    window.__fixtureIPC.state.transcription = "error";
    transcription.begin(false, false);
    transcription.capture(new Blob([new Uint8Array(128)]));
    void transcription.transcribe();
    return true;
  },
  startSuccessful() {
    window.__fixtureIPC.state.transcription = "immediate";
    window.__fixtureIPC.state.cleanup = "immediate";
    transcription.begin(true, true);
    transcription.capture(new Blob([new Uint8Array(128)]));
    return transcription.transcribe();
  },
  snapshot: () => window.__fixtureIPC.snapshot(),
} });
document.dispatchEvent(new CustomEvent("recovery-fixture-ready"));
`;

const plugin = {
  name: "rendered-recovery-fixture",
  enforce: "post",
  transform(code, id) {
    const source = id.split("?")[0].replaceAll("\\", "/");
    if (source.endsWith("/src/dictationController.ts")) return code.replace("// Fixture hook insertion point", appendedHooks);
    if (source.endsWith("/src/transcriptionSession.ts")) return code.replace(
      "stalledMs: 12_000, transcriptionMs: 100_000, cleanupMs: 30_000, targetMs: 5_000, insertionMs: 15_000,",
      "stalledMs: 250, transcriptionMs: 60_000, cleanupMs: 60_000, targetMs: 5_000, insertionMs: 15_000,",
    );
    return null;
  },
  configureServer(server) {
    server.middlewares.use("/recovery-fixture.html", async (_request, response, next) => {
      try {
        let html = await readFile(indexPath, "utf8");
        html = html.replace(
          '<script type="module" src="/src/main.tsx"></script>',
          `${bridge}<script type="module" src="/src/main.tsx?recoveryFixture"></script>`,
        );
        html = html.replace("<body>", `<body>${controls}`);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await server.transformIndexHtml("/recovery-fixture.html", html));
      } catch (error) { next(error); }
    });
  },
};

export function createRecoveryFixtureServer(port = Number(process.env.UI_FIXTURE_PORT ?? 1422), target = process.env.UI_FIXTURE_PLATFORM ?? "windows") {
  return createServer({
  configFile: false,
  root,
  resolve: { alias: platformAlias(target) },
  // The native dev server may be running concurrently. Different optimizer
  // configs must not replace its cached modules and strand a hidden WebView.
  cacheDir: resolve(root, `node_modules/.vite-recovery-fixture-${target}`),
  plugins: [plugin],
  server: { host: "127.0.0.1", port, strictPort: true },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createRecoveryFixtureServer();
  await server.listen();
  console.log(`Rendered recovery fixture: http://localhost:${server.config.server.port}/recovery-fixture.html`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => { await server.close(); process.exit(0); });
  }
}
