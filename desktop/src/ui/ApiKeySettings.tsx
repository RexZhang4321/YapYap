import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { apiKeyErrorMessage, clearAndSubmitApiKey } from "../apiKey";
import { ui } from "./store";
import { useUi } from "./View";

export function ApiKeySettings() {
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(true);
  const [hasDraft, setHasDraft] = useState(false);
  const [keyState, setKeyState] = useState("unknown");
  const [storedStatus, setStoredStatus] = useState("Checking for a saved key…");
  const [status, setStatus] = useState("");
  const active = useUi(ui.active);
  const locked = busy || active;

  async function refresh() {
    try {
      const saved = await invoke<boolean>("has_api_key");
      setKeyState(saved ? "saved" : "missing");
      setStoredStatus(
        saved ? "API key saved securely." : "Add a key to start dictating.",
      );
      ui.setKeyState({
        state: saved ? "saved" : "missing",
        busy: running.current,
      });
    } catch {
      setKeyState("unknown");
      setStoredStatus(
        "Windows could not read your saved key. Save it again or remove it.",
      );
      ui.setKeyState({ state: "unknown", busy: running.current });
    }
  }
  useEffect(() => {
    running.current = true;
    void refresh().finally(() => {
      running.current = false;
      setBusy(false);
      ui.setKeyState({ ...ui.keyState(), busy: false });
    });
    ui.attach("api-key", input.current);
    return () => {
      ui.attach("api-key", null);
    };
  }, []);

  async function run(
    work: () => Promise<void>,
    pending: string,
    success: string,
  ) {
    if (running.current || ui.active()) return;
    running.current = true;
    setBusy(true);
    setStatus(pending);
    ui.setKeyState({ ...ui.keyState(), busy: true });
    try {
      await work();
      setStatus(success);
    } catch (error) {
      setStatus(apiKeyErrorMessage(error));
    } finally {
      await refresh();
      running.current = false;
      setBusy(false);
      ui.setKeyState({ ...ui.keyState(), busy: false });
    }
  }

  return (
    <section className="settings-section" aria-labelledby="api-key-heading">
      <h3 id="api-key-heading">OpenAI API key</h3>
      <p id="api-key-stored-status" role="status" data-state={keyState}>
        {storedStatus}
      </p>
      <form
        id="api-key-form"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked || !input.current?.value.trim()) return;
          const field = input.current;
          // The password is cleared synchronously before IPC and is never a state snapshot.
          void run(
            () =>
              clearAndSubmitApiKey(field, (key) =>
                invoke<void>("save_api_key", { key }),
              ),
            "Saving securely…",
            "Key saved. You can start dictating when your microphone is ready.",
          );
          setHasDraft(false);
        }}
      >
        <label htmlFor="api-key">Add or replace your key</label>
        <div className="row">
          <input
            ref={input}
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-describedby="api-key-hint"
            placeholder="Paste API key"
            disabled={locked}
            onInput={(event) =>
              setHasDraft(Boolean(event.currentTarget.value.trim()))
            }
          />
          <button
            id="save-api-key"
            type="submit"
            className="primary-button"
            disabled={locked || !hasDraft}
          >
            Save key
          </button>
        </div>
      </form>
      <div className="row recording-actions">
        <button
          id="validate-api-key"
          type="button"
          disabled={locked || keyState !== "saved"}
          onClick={() => {
            void run(
              () => invoke<void>("validate_api_key"),
              "Checking the saved key with OpenAI…",
              "Connected to OpenAI. Model access will be checked when you dictate.",
            );
          }}
        >
          Check connection
        </button>
        <button
          id="remove-api-key"
          type="button"
          className="quiet-button"
          disabled={locked || keyState === "missing"}
          onClick={() => {
            if (input.current) input.current.value = "";
            setHasDraft(false);
            void run(
              () => invoke<void>("delete_api_key"),
              "Removing the saved key…",
              "The saved key was removed.",
            );
          }}
        >
          Remove key
        </button>
      </div>
      <p id="api-key-status" role="status">
        {status}
      </p>
      <p id="api-key-hint" className="hint">
        Stored securely in Windows Credential Manager. Checking the connection
        sends no recording. Dictation sends audio directly to OpenAI.
      </p>
    </section>
  );
}
