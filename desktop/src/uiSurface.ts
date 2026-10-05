// Navigation stays separate from recording and session ownership.
export function initializeSurface() {
  const dialog = document.querySelector<HTMLDialogElement>("#settings-dialog")!;
  const open = () => { if (!dialog.open) dialog.showModal(); };
  document.querySelector<HTMLButtonElement>("#open-settings")!.addEventListener("click", open);
  document.querySelector<HTMLButtonElement>("#open-setup")!.addEventListener("click", () => {
    open();
    const key = document.querySelector<HTMLInputElement>("#api-key")!;
    const needsKey = document.querySelector<HTMLElement>("#api-key-stored-status")!.dataset.state !== "saved";
    const microphone = document.querySelector<HTMLButtonElement>("#prepare-microphone")!;
    if (needsKey && !key.disabled) key.focus();
    else if (!microphone.hidden && !microphone.disabled) microphone.focus();
    else document.querySelector<HTMLButtonElement>("#shortcut-record")!.focus();
  });
  document.querySelector<HTMLButtonElement>("#settings-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
