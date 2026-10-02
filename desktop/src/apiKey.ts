import { invoke } from "@tauri-apps/api/core";

// Backend errors are codes. Never display/log raw IPC errors or provider responses.
const errorMessages: Record<string, string> = {
  key_empty: "Enter an API key first.",
  key_format: "The key must contain only printable ASCII characters without spaces and be at most 2,560 bytes.",
  key_missing: "No API key is saved. Enter and save a key first.",
  credential_write_failed: "Windows could not save the key. Try again or check Credential Manager.",
  credential_read_failed: "Windows could not read the saved key. Try again or check Credential Manager.",
  credential_delete_failed: "Windows could not remove the key. Try again or remove it in Credential Manager.",
  credential_invalid: "The saved credential could not be read. Save a replacement key or remove it.",
  credential_operation_failed: "The credential operation could not be completed. Try again.",
  credential_platform_unsupported: "Secure API-key storage is available on Windows in this probe.",
  validation_unauthorized: "OpenAI rejected the saved key. It may be invalid or revoked. Save a replacement key.",
  validation_forbidden: "This key cannot access the models endpoint. Check its permissions; transcription access still needs a separate check.",
  validation_rate_limited: "OpenAI returned a rate or usage limit. Check your account and retry. The key is still saved.",
  validation_provider_unavailable: "OpenAI is temporarily unavailable. Retry later; the key is still saved.",
  validation_redirect: "OpenAI returned a redirect. Validation stopped before following it; the key is still saved.",
  validation_unexpected_response: "OpenAI returned an unexpected response. Validation could not be confirmed; the key is still saved.",
  validation_timeout: "Validation timed out. Check your connection and retry; the key is still saved.",
  validation_tls_failed: "A secure connection to OpenAI could not be verified. Check your connection; the key is still saved.",
  validation_network_failed: "Could not connect to OpenAI. Check your connection and retry; the key is still saved.",
};

export function apiKeyErrorMessage(error: unknown): string {
  return typeof error === "string" && Object.prototype.hasOwnProperty.call(errorMessages, error)
    ? errorMessages[error]
    : "The API-key operation could not be completed. Try again.";
}

export function clearAndSubmitApiKey(input: { value: string }, save: (key: string) => Promise<void>): Promise<void> {
  const key = input.value;
  input.value = "";
  return save(key);
}

export function initializeApiKeySettings() {
  const form = document.querySelector<HTMLFormElement>("#api-key-form")!;
  const input = document.querySelector<HTMLInputElement>("#api-key")!;
  const save = document.querySelector<HTMLButtonElement>("#save-api-key")!;
  const validate = document.querySelector<HTMLButtonElement>("#validate-api-key")!;
  const remove = document.querySelector<HTMLButtonElement>("#remove-api-key")!;
  const storedStatus = document.querySelector<HTMLElement>("#api-key-stored-status")!;
  const operationStatus = document.querySelector<HTMLElement>("#api-key-status")!;
  let hasKey = false;
  let busy = false;

  function controls() {
    input.disabled = busy;
    save.disabled = busy || !input.value.trim();
    validate.disabled = busy || !hasKey;
    // A corrupt/unreadable entry must still be removable.
    remove.disabled = busy || storedStatus.dataset.state === "missing";
  }

  async function refresh() {
    try {
      hasKey = await invoke<boolean>("has_api_key");
      storedStatus.textContent = hasKey ? "An API key is saved securely on this Windows account." : "No API key is saved.";
      storedStatus.dataset.state = hasKey ? "saved" : "missing";
    } catch {
      hasKey = false;
      storedStatus.textContent = "Saved-key status is unavailable. You can retry saving or remove the stored credential.";
      storedStatus.dataset.state = "unknown";
    }
  }

  async function run(work: () => Promise<void>, pending: string, success: string) {
    if (busy) return;
    busy = true;
    operationStatus.textContent = pending;
    controls();
    try {
      await work();
      operationStatus.textContent = success;
    } catch (error: unknown) {
      operationStatus.textContent = apiKeyErrorMessage(error);
    } finally {
      await refresh();
      busy = false;
      controls();
    }
  }

  input.addEventListener("input", controls);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    // Clear before invoking IPC, including when invocation throws synchronously.
    void run(() => clearAndSubmitApiKey(input, (key) => invoke<void>("save_api_key", { key })),
      "Saving securely…", "Key saved securely. Choose Validate saved key to check API access.");
  });
  validate.addEventListener("click", () => {
    void run(() => invoke<void>("validate_api_key"), "Checking the saved key with OpenAI…",
      "OpenAI accepted the saved key. Transcription model access will be checked by the transcription probe.");
  });
  remove.addEventListener("click", () => {
    input.value = "";
    void run(() => invoke<void>("delete_api_key"), "Removing the saved key…", "The saved key was removed.");
  });
  // No API request on launch. Fetch only presence, never the secret itself.
  void run(async () => {}, "Checking for a saved key…", "Validation runs only when you choose Validate saved key.");
}
