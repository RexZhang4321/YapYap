const messages: Record<string, string> = {
  key_missing: "No API key is saved. Save a key above, then retry.",
  key_format: "The saved key is invalid. Save a replacement key, then retry.",
  credential_read_failed: "Windows could not read the saved key. Check Credential Manager, then retry.",
  credential_invalid: "The saved credential could not be read. Save a replacement key, then retry.",
  credential_platform_unsupported: "This probe requires Windows secure key storage.",
  transcription_unauthorized: "OpenAI rejected the key. It may be invalid, expired, or revoked. Save a replacement, then retry.",
  transcription_forbidden: "The saved key cannot access transcription. Check its API permissions, then retry.",
  transcription_model_unavailable: "The transcription model could not be accessed. Check account access before retrying.",
  transcription_rate_limited: "OpenAI returned a rate or usage limit. Check account limits and billing, then retry later.",
  transcription_provider_unavailable: "OpenAI is temporarily unavailable. Retry later.",
  transcription_redirect: "The request stopped because OpenAI returned a redirect.",
  transcription_unexpected_response: "OpenAI could not accept this request. The recording is still available.",
  transcription_audio_invalid: "No valid, nonempty recording is available for transcription. Discard and record again.",
  transcription_audio_too_large: "The WAV exceeds the 25 MB upload limit. Discard and make a shorter recording.",
  transcription_response_invalid: "OpenAI returned an unreadable transcript. Retry the recording.",
  transcription_response_too_large: "The response exceeded the probe's limit. The recording is still available.",
  transcription_empty: "No speech transcript was returned. Listen to the recording, then retry or discard.",
  transcription_busy: "A transcription request is already running. Wait for it to finish.",
  validation_timeout: "Transcription timed out. Check the connection, then retry.",
  validation_tls_failed: "A secure connection to OpenAI could not be verified. Check the connection, then retry.",
  validation_network_failed: "Could not connect to OpenAI. Check the connection, then retry.",
};

export function transcriptionError(code: string): string {
  return Object.prototype.hasOwnProperty.call(messages, code)
    ? messages[code]
    : "Transcription could not be completed. Retry or discard the recording.";
}
