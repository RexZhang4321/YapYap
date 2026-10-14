import { knownMessage, unsupportedCredentialMessage } from "./shared.ts";
export {
  preferencesSaveFailed,
  unsupportedCredentialHint as credentialHint,
} from "./shared.ts";

export const platformName = "unsupported";
export const supportsCredentialStorage = false;
export const showOverlayFixture = false;
export const platformNotice = Object.freeze({
  title: "Native features unavailable",
  text: "Native dictation capabilities could not be enabled. Check that you are running a supported native build.",
});
export const pasteShortcut = "your system paste shortcut";
export const shortcutUseHint =
  "Use Ctrl, Alt, or the system modifier with another key.";
export const shortcutCaptureHint =
  "Press Ctrl, Alt, or the system modifier with another key. Esc cancels.";
export const microphoneAccessHelp =
  "Microphone access is checked automatically. Allow access once when your system asks.";
export const microphoneSettingsHelp =
  "Allow microphone access in your system settings, then retry in Settings.";
export const microphoneDenied =
  "Microphone access was denied. Allow microphone access for this app in your system settings, then refresh the device list and try again.";
export const noMicrophone =
  "No microphone is listed. The system default may still work; connect an input or check microphone access in your system settings.";
export const openApp = "Open YapYap";
export const backgroundHint = "Use Quit to exit YapYap.";

const credentialMessages = {
  credential_write_failed:
    "Could not save the key. Try again or check the system credential store.",
  credential_read_failed:
    "Could not read the saved key. Try again or check the system credential store.",
  credential_delete_failed:
    "Could not remove the key. Try again or remove it in the system credential store.",
  credential_platform_unsupported: unsupportedCredentialMessage,
};
export function credentialErrorMessage(code: string) {
  return knownMessage(credentialMessages, code);
}
export function formatShortcut(shortcut: string) {
  return shortcut;
}

export const insertionTestText = "YapYap dictation insertion probe";
