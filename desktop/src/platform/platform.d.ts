// Every selected module implements these ordinary named exports.
export declare const platformName: "windows" | "macos" | "unsupported";
export declare const supportsCredentialStorage: boolean;
export declare const showOverlayFixture: boolean;
export declare const platformNotice: Readonly<{
  title: string;
  text: string;
}> | null;
export declare const credentialHint: string;
export declare const pasteShortcut: string;
export declare const shortcutUseHint: string;
export declare const shortcutCaptureHint: string;
export declare const microphoneAccessHelp: string;
export declare const microphoneSettingsHelp: string;
export declare const microphoneDenied: string;
export declare const noMicrophone: string;
export declare const preferencesSaveFailed: string;
export declare const openApp: string;
export declare const backgroundHint: string;
export declare function credentialErrorMessage(
  code: string,
): string | undefined;
export declare function formatShortcut(shortcut: string): string;
