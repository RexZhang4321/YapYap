import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";

const shortcutInput = document.querySelector<HTMLInputElement>("#shortcut")!;
const status = document.querySelector<HTMLElement>("#status")!;
const holdState = document.querySelector<HTMLElement>("#hold-state")!;
const events = document.querySelector<HTMLOListElement>("#events")!;

let activeShortcut: string | null = null;
let held = false;

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

function onShortcut(event: ShortcutEvent) {
  if (event.state === "Pressed") {
    log(event.shortcut + " key-down");
    held = true;
  } else {
    log(event.shortcut + " key-up");
    held = false;
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

showState();
void applyShortcut(shortcutInput.value);
