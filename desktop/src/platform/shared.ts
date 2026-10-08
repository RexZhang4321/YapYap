export const preferencesSaveFailed =
  "Settings work for this session. Your system could not save them for next time.";
export const unsupportedCredentialMessage =
  "Secure API-key storage and provider requests are unavailable in this platform probe.";
export const unsupportedCredentialHint =
  "Key storage is unavailable in this probe. API-key entry is disabled.";

export function knownMessage(
  messages: Readonly<Record<string, string>>,
  code: string,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code]
    : undefined;
}

export function formatWithNames(
  shortcut: string,
  names: Readonly<Record<string, string>>,
): string {
  return shortcut
    .split("+")
    .map((part) => names[part] ?? part)
    .join("+");
}
