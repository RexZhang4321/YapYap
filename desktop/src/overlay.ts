import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { overlayCopy, type OverlaySnapshot } from "./overlayState";

let revision = -1;
let epoch = -1;
function render(snapshot: OverlaySnapshot) {
  if (!Number.isSafeInteger(snapshot.epoch) || !Number.isSafeInteger(snapshot.revision)
    || snapshot.epoch < epoch || (snapshot.epoch === epoch && snapshot.revision <= revision)
    || !Object.prototype.hasOwnProperty.call(overlayCopy, snapshot.phase)) return;
  epoch = snapshot.epoch;
  revision = snapshot.revision;
  const copy = overlayCopy[snapshot.phase];
  document.querySelector<HTMLElement>("#overlay")!.dataset.phase = snapshot.phase;
  document.querySelector<HTMLElement>("#overlay-title")!.textContent = copy.title;
  document.querySelector<HTMLElement>("#overlay-text")!.textContent = copy.text;
  document.querySelector<HTMLElement>("#overlay-hint")!.textContent = copy.hint;
}

// Listen before fetching the snapshot so loading/reloading cannot miss a state.
async function initialize() {
  await listen<OverlaySnapshot>("overlay-state", event => render(event.payload));
  render(await invoke<OverlaySnapshot>("overlay_snapshot"));
}
void initialize().catch(() => {
  document.querySelector<HTMLElement>("#overlay-title")!.textContent = "Open the probe from the tray";
});
