import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { OverlayReceiver, overlayPresentation, type OverlaySnapshot } from "./overlayState";

const receiver = new OverlayReceiver();
function render(snapshot: OverlaySnapshot) {
  if (!receiver.accept(snapshot)) return;
  const copy = overlayPresentation(snapshot);
  const panel = document.querySelector<HTMLElement>("#overlay")!;
  panel.dataset.phase = snapshot.phase;
  panel.dataset.warning = String(copy.warning);
  document.querySelector<HTMLElement>("#overlay-title")!.textContent = copy.title;
  document.querySelector<HTMLElement>("#overlay-label")!.textContent = copy.label;
  const text = document.querySelector<HTMLElement>("#overlay-text")!;
  text.textContent = copy.text;
  text.scrollTop = text.scrollHeight;
  document.querySelector<HTMLElement>("#overlay-hint")!.textContent = copy.hint;
}

// Listen before fetching the snapshot so loading/reloading cannot miss a state.
async function initialize() {
  await listen<OverlaySnapshot>("overlay-state", event => render(event.payload));
  render(await invoke<OverlaySnapshot>("overlay_snapshot"));
}
void initialize().catch(() => {
  document.querySelector<HTMLElement>("#overlay-title")!.textContent = "Open Dictation from the tray";
});
