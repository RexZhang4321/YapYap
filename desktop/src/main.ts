import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";

const shortcutInput = document.querySelector<HTMLInputElement>("#shortcut")!;
const status = document.querySelector<HTMLElement>("#status")!;
const holdState = document.querySelector<HTMLElement>("#hold-state")!;
const events = document.querySelector<HTMLOListElement>("#events")!;
const insertionStatus = document.querySelector<HTMLElement>("#insertion-status")!;
const restoreButton = document.querySelector<HTMLButtonElement>("#restore-clipboard")!;

let activeShortcut: string | null = null;
let held = false;
let capture: Promise<string> | null = null;
let inserting = false;

function log(message: string) {
  const line = new Date().toISOString() + "  " + message;
  const item = document.createElement("li");
  item.textContent = line;
  events.prepend(item);
  console.info(line);
}

function showState() {
  holdState.textContent = held ? "DOWN" : "UP";
}

async function refreshRestoreButton() {
  try {
    restoreButton.disabled = !(await invoke<boolean>("has_clipboard_backup"));
  } catch {
    restoreButton.disabled = true;
  }
}

function onShortcut(event: ShortcutEvent) {
  if (event.state === "Pressed") {
    if (held || inserting) return;
    log(event.shortcut + " key-down");
    held = true;
    capture = invoke<string>("capture_target");
    insertionStatus.textContent = "Capturing the focused target…";
  } else {
    if (!held) return;
    log(event.shortcut + " key-up");
    held = false;
    inserting = true;
    const pendingCapture = capture;
    capture = null;
    void (async () => {
      try {
        if (!pendingCapture) throw new Error("No target capture was started.");
        await pendingCapture;
        insertionStatus.textContent = "Checking target and clipboard…";
        const result = await invoke<string>("insert_test_text");
        insertionStatus.textContent = result;
        log(result);
      } catch (error) {
        insertionStatus.textContent = String(error) + " Use Copy test text if needed.";
        log("insertion unavailable: " + String(error));
      } finally {
        inserting = false;
        await refreshRestoreButton();
      }
    })();
  }
  showState();
}

async function applyShortcut(shortcut: string) {
  const next = shortcut.trim();
  if (!next) {
    status.textContent = "Enter a shortcut first.";
    return;
  }
  if (next === activeShortcut) return;

  try {
    await register(next, onShortcut);
    if (activeShortcut) await unregister(activeShortcut);
    activeShortcut = next;
    held = false;
    showState();
    status.textContent = "Registered: " + next;
    log("registered " + next);
  } catch (error) {
    status.textContent = "Registration failed: " + String(error);
    log("registration failed for " + next + ": " + String(error));
  }
}

document.querySelector<HTMLFormElement>("#shortcut-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void applyShortcut(shortcutInput.value);
});

document.querySelector<HTMLButtonElement>("#clear-log")!.addEventListener("click", () => {
  events.replaceChildren();
});

document.querySelector<HTMLButtonElement>("#copy-text")!.addEventListener("click", async () => {
  try {
    insertionStatus.textContent = await invoke<string>("copy_test_text");
  } catch (error) {
    insertionStatus.textContent = "Copy failed: " + String(error);
  } finally {
    await refreshRestoreButton();
  }
});

document.querySelector<HTMLButtonElement>("#copy-without-backup")!.addEventListener("click", async () => {
  try {
    insertionStatus.textContent = await invoke<string>("copy_test_text_without_backup");
  } catch (error) {
    insertionStatus.textContent = "Copy failed: " + String(error);
  } finally {
    await refreshRestoreButton();
  }
});

restoreButton.addEventListener("click", async () => {
  try {
    insertionStatus.textContent = await invoke<string>("restore_previous_clipboard");
  } catch (error) {
    insertionStatus.textContent = "Restore failed: " + String(error);
  } finally {
    await refreshRestoreButton();
  }
});

showState();
void refreshRestoreButton();
void applyShortcut(shortcutInput.value);
