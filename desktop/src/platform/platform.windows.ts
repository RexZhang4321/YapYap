import {
  knownMessage,
  formatWithNames,
  unsupportedCredentialMessage,
} from "./shared.ts";
export { preferencesSaveFailed } from "./shared.ts";

export const platformName = "windows";
export const supportsCredentialStorage = true;
export const showOverlayFixture = false;
export const platformNotice = null;
export const credentialHint =
  "Stored securely in Windows Credential Manager. Checking the connection sends no recording. Dictation sends audio directly to OpenAI.";
export const pasteShortcut = "Ctrl+V";
export const shortcutUseHint = "Use Ctrl, Alt, or Windows with another key.";
export const shortcutCaptureHint =
  "Press Ctrl, Alt, or Windows with another key. Esc cancels.";
export const microphoneAccessHelp =
  "Microphone access is checked automatically. Allow access once when Windows asks.";
export const microphoneSettingsHelp =
  "Allow microphone access in Windows settings, then retry in Settings.";
export const microphoneDenied =
  "Microphone access was denied. Allow microphone access for this app in Windows settings, then refresh the device list and try again.";
export const noMicrophone =
  "No microphone is listed. The system default may still work; connect an input or check microphone access in Windows settings.";
export const openApp = "Open YapYap from the tray";
export const backgroundHint = "Close to keep dictating from the tray.";

const credentialMessages = {
  credential_write_failed:
    "Windows could not save the key. Try again or check Credential Manager.",
  credential_read_failed:
    "Windows could not read the saved key. Try again or check Credential Manager.",
  credential_delete_failed:
    "Windows could not remove the key. Try again or remove it in Credential Manager.",
  credential_platform_unsupported: unsupportedCredentialMessage,
};
export function credentialErrorMessage(code: string) {
  return knownMessage(credentialMessages, code);
}
export function formatShortcut(shortcut: string) {
  return formatWithNames(shortcut, { Super: "Windows" });
}
