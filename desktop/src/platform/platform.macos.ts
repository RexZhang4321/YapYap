import {
  knownMessage,
  formatWithNames,
} from "./shared.ts";
export {
  preferencesSaveFailed,
} from "./shared.ts";

export const platformName = "macos";
export function cancelShortcuts(shortcut: string | null): string[] {
  const modifiers = shortcut?.split("+").slice(0, -1).join("+");
  return modifiers ? ["Escape", `${modifiers}+Escape`] : ["Escape"];
}
// These describe the current probe build, not OS permission grants. Enable
// storage only after the native Keychain implementation is available.
export const supportsCredentialStorage = true;
export const credentialHint = "Stored securely in macOS Keychain. Live transcription sends audio directly to OpenAI.";
export const showOverlayFixture = true;
// WebKit withholds microphone audio from a hidden window; AVAudioEngine keeps
// recording while YapYap is closed to the menu bar.
export const nativeMicrophoneCapture = true;
export const platformNotice = Object.freeze({
  title: "macOS feasibility probe",
  text: "Recording, live overlay, guarded insertion and clipboard recovery are under test. Automatic paste requires Accessibility access in macOS System Settings. Settings → Developer diagnostics includes microphone and live transcription tests.",
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
  credential_access_denied:
    "Keychain access is blocked. Choose Unlock saved key and respond to the macOS prompt.",
  credential_delete_failed:
    "Could not remove the key. Try again or remove it in Keychain.",
  credential_platform_unsupported:
    "This credential operation is unavailable. Your saved key is unchanged.",
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

export const insertionTestText = "YapYap dictation insertion probe\n你好 😀 — café\nsecond line";
