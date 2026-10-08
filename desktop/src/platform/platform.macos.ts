import {
  knownMessage,
  formatWithNames,
  unsupportedCredentialMessage,
} from "./shared.ts";
export {
  preferencesSaveFailed,
  unsupportedCredentialHint as credentialHint,
} from "./shared.ts";

export const platformName = "macos";
// These describe the current probe build, not OS permission grants. Enable
// storage only after the native Keychain implementation is available.
export const supportsCredentialStorage = false;
export const showOverlayFixture = true;
export const platformNotice = Object.freeze({
  title: "macOS feasibility probe",
  text: "This build tests the app shell. Unavailable features: secure key storage, provider requests, automatic insertion, clipboard recovery. Settings → Developer diagnostics includes a fixed overlay fixture.",
});
export const pasteShortcut = "Command+V";
export const shortcutUseHint =
  "Use Control, Option, or Command with another key.";
export const shortcutCaptureHint =
  "Press Control, Option, or Command with another key. Esc cancels.";
export const microphoneAccessHelp =
  "Microphone access is checked automatically. Allow access once when your system asks.";
export const microphoneSettingsHelp =
  "Allow microphone access in macOS System Settings, then retry in Settings.";
export const microphoneDenied =
  "Microphone access was denied. Allow microphone access for this app in macOS System Settings, then refresh the device list and try again.";
export const noMicrophone =
  "No microphone is listed. The system default may still work; connect an input or check microphone access in macOS System Settings.";
export const openApp = "Open YapYap from the menu bar";
export const backgroundHint = "Close to keep YapYap in the menu bar.";

const credentialMessages = {
  credential_write_failed:
    "Could not save the key. Try again or check Keychain.",
  credential_read_failed:
    "Could not read the saved key. Try again or check Keychain.",
  credential_delete_failed:
    "Could not remove the key. Try again or remove it in Keychain.",
  credential_platform_unsupported: unsupportedCredentialMessage,
};
export function credentialErrorMessage(code: string) {
  return knownMessage(credentialMessages, code);
}
export function formatShortcut(shortcut: string) {
  return formatWithNames(shortcut, {
    Ctrl: "Control",
    Alt: "Option",
    Super: "Command",
  });
}
