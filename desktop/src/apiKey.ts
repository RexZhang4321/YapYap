// Backend errors are codes. Never display/log raw IPC errors or provider responses.
const errorMessages: Record<string, string> = {
  key_empty: "Enter an API key first.",
  key_format: "Paste the API key without spaces or extra characters.",
  key_missing: "No API key is saved. Enter and save a key first.",
  credential_write_failed:
    "Windows could not save the key. Try again or check Credential Manager.",
  credential_read_failed:
    "Windows could not read the saved key. Try again or check Credential Manager.",
  credential_delete_failed:
    "Windows could not remove the key. Try again or remove it in Credential Manager.",
  credential_invalid:
    "The saved credential could not be read. Save a replacement key or remove it.",
  credential_operation_failed:
    "The credential operation could not be completed. Try again.",
  credential_platform_unsupported:
    "Secure API-key storage is available on Windows.",
  validation_unauthorized:
    "OpenAI rejected the saved key. It may be invalid or revoked. Save a replacement key.",
  validation_forbidden:
    "This key cannot access the models endpoint. Check its permissions; transcription access still needs a separate check.",
  validation_rate_limited:
    "OpenAI returned a rate or usage limit. Check your account and retry. The key is still saved.",
  validation_provider_unavailable:
    "OpenAI is temporarily unavailable. Retry later; the key is still saved.",
  validation_redirect:
    "OpenAI returned a redirect. Validation stopped before following it; the key is still saved.",
  validation_unexpected_response:
    "OpenAI returned an unexpected response. Validation could not be confirmed; the key is still saved.",
  validation_timeout:
    "Validation timed out. Check your connection and retry; the key is still saved.",
  validation_tls_failed:
    "A secure connection to OpenAI could not be verified. Check your connection; the key is still saved.",
  validation_network_failed:
    "Could not connect to OpenAI. Check your connection and retry; the key is still saved.",
};

export function apiKeyErrorMessage(error: unknown): string {
  return typeof error === "string" &&
    Object.prototype.hasOwnProperty.call(errorMessages, error)
    ? errorMessages[error]
    : "The API-key operation could not be completed. Try again.";
}

export function clearAndSubmitApiKey(
  input: { value: string },
  save: (key: string) => Promise<void>,
): Promise<void> {
  const key = input.value;
  input.value = "";
  return save(key);
}
