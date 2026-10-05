import { useEffect, useRef } from "react";
import { initializeDictation } from "../dictationController";
import { ui } from "./store";
import { View } from "./View";
import { SettingsContent } from "./SettingsContent";
import { AppHeader, Readiness, SetupCallout, AppFooter } from "./Home";
import {
  LivePreview,
  SessionRecovery,
  ClipboardRecovery,
  RetainedResults,
} from "./SessionRecovery";

export function App() {
  const settingsRef = useRef<HTMLDialogElement>(null);
  const recoveryRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    initializeDictation({
      playback: () => ui.element<HTMLAudioElement>("recording-playback"),
      recoveryDialog: () =>
        ui.element<HTMLDialogElement>("recovery-confirm-dialog"),
    });
    const open = (setup = false) => {
      const dialog = settingsRef.current!;
      if (!dialog.open) dialog.showModal();
      if (!setup) return;
      const key = ui.element<HTMLInputElement>("api-key");
      const microphone = ui.element<HTMLButtonElement>("prepare-microphone");
      if (ui.keyState().state !== "saved" && !key.disabled) key.focus();
      else if (!microphone.hidden && !microphone.disabled) microphone.focus();
      else ui.focus("shortcut-record");
    };
    const cleanups = [
      ui.on("open-settings", "click", () => open()),
      ui.on("open-setup", "click", () => open(true)),
      ui.on("settings-close", "click", () => settingsRef.current!.close()),
    ];
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
  return (
    <>
      <main className="app-shell">
        <AppHeader />
        <Readiness />
        <SetupCallout />
        <LivePreview />
        <SessionRecovery />
        <ClipboardRecovery />
        <RetainedResults />
        <AppFooter />
      </main>
      <dialog
        id="recovery-confirm-dialog"
        aria-labelledby="recovery-confirm-heading"
        aria-describedby="recovery-confirm-warning"
        ref={(element) => {
          recoveryRef.current = element;
          ui.attach("recovery-confirm-dialog", element);
        }}
      >
        <div className="settings-header">
          <View as="h2" id="recovery-confirm-heading" />
        </div>
        <form method="dialog" className="recovery-confirm-content">
          <View as="p" id="recovery-confirm-warning" />
          <View
            as="label"
            id="recovery-confirm-label"
            htmlFor="recovery-confirm-text"
          />
          <View
            as="textarea"
            id="recovery-confirm-text"
            rows={8}
            readOnly
            spellCheck={false}
          />
          <p className="hint">
            {
              "This copies the exact text above. Return to your intended text field and press Ctrl+V to paste."
            }
          </p>
          <div className="row recording-actions">
            <View
              as="button"
              id="recovery-confirm-copy"
              type="submit"
              className="primary-button"
            />
            <View as="button" id="recovery-confirm-cancel" type="submit" />
          </div>
        </form>
      </dialog>
      <dialog
        id="settings-dialog"
        aria-labelledby="settings-heading"
        ref={settingsRef}
        onClose={(event) =>
          ui.dispatch("settings-dialog", "close", event.nativeEvent)
        }
        onClick={(event) => {
          const dialog = event.currentTarget;
          if (event.target !== dialog) return;
          const bounds = dialog.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            dialog.close();
        }}
      >
        <div className="settings-header">
          <View as="h2" id="settings-heading" />
          <View
            as="button"
            id="settings-close"
            type="button"
            className="quiet-button"
            aria-label="Close settings"
          />
        </div>
        <SettingsContent />
      </dialog>
    </>
  );
}
