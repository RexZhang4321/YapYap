export const initialControls = {
  "open-settings": {
    text: "Settings",
  },
  "home-panel": {
    state: "checking",
  },
  "dictation-status": {
    text: "Getting ready…",
  },
  "dictation-detail": {
    hidden: true,
  },
  "dictation-alert": {
    hidden: true,
  },
  "dictation-alert-text": {},
  "shortcut-display": {
    text: "Ctrl + Alt + F8",
  },
  "cancel-hint": {
    text: "Press Esc to cancel before insertion.",
  },
  "cancel-dictation": {
    text: "Cancel dictation",
    hidden: true,
  },
  "setup-callout": {},
  "setup-message": {
    text: "Add your OpenAI API key and allow microphone access to start dictating.",
  },
  "open-setup": {
    text: "Set up dictation",
  },
  "live-panel": {
    hidden: true,
  },
  "live-heading": {
    text: "Live words",
  },
  "live-status": {
    text: "Live preview ready.",
  },
  "live-transcript": {},
  "live-reconnect": {
    text: "Reconnect preview",
    disabled: true,
  },
  "provisional-recovery": {
    hidden: true,
  },
  "copy-provisional": {
    text: "Copy live words",
    disabled: true,
  },
  "copy-provisional-without-backup": {
    text: "Replace clipboard with live words",
    disabled: true,
  },
  "provisional-copy-status": {},
  "recovery-panel": {
    hidden: true,
  },
  "recovery-heading": {
    text: "Current dictation",
  },
  "discard-transcription": {
    text: "Discard",
    disabled: true,
  },
  "transcription-status": {},
  "cleanup-status": {},
  "processing-recovery": {
    hidden: true,
  },
  "processing-recovery-hint": {},
  "bypass-processing": {
    text: "Review available text…",
    hidden: true,
  },
  "stop-waiting": {
    text: "Stop waiting · keep recovery",
  },
  "recovery-copy-status": {},
  "audio-recovery": {
    hidden: true,
  },
  "recording-playback": {
    hidden: true,
  },
  "transcribe-recording": {
    text: "Retry transcription",
    disabled: true,
  },
  "play-recording": {
    text: "Play recording",
    disabled: true,
  },
  "stop-playback": {
    text: "Stop playback",
    disabled: true,
  },
  "current-result": {
    hidden: true,
  },
  "cleaned-transcript-panel": {},
  "cleaned-transcript": {},
  "copy-transcript": {
    text: "Copy text",
    disabled: true,
  },
  "copy-original": {
    text: "Copy original",
    disabled: true,
  },
  "copy-status": {},
  "original-transcript-panel": {},
  transcript: {},
  "copy-transcript-without-backup": {
    text: "Replace clipboard with text",
    disabled: true,
  },
  "copy-original-without-backup": {
    text: "Replace clipboard with original",
    disabled: true,
  },
  "clipboard-recovery": {
    hidden: true,
  },
  "restore-clipboard": {
    text: "Restore previous clipboard",
    disabled: true,
  },
  "retained-panel": {
    hidden: true,
  },
  "retained-heading": {
    text: "Saved for this session",
  },
  "retained-copy-status": {},
  "retained-results": {},
  "recovery-confirm-dialog": {},
  "recovery-confirm-heading": {
    text: "Review text before copying",
  },
  "recovery-confirm-warning": {},
  "recovery-confirm-label": {
    text: "Available text",
  },
  "recovery-confirm-text": {},
  "recovery-confirm-copy": {
    text: "Confirm and copy",
    value: "copy",
  },
  "recovery-confirm-cancel": {
    text: "Keep waiting",
    value: "cancel",
  },
  "settings-dialog": {},
  "settings-heading": {
    text: "Settings",
  },
  "settings-close": {
    text: "Done",
  },
  "api-key-heading": {
    text: "OpenAI API key",
  },
  "api-key-stored-status": {
    text: "Checking for a saved key…",
    state: "unknown",
  },
  "api-key-form": {},
  "save-api-key": {
    text: "Save key",
    disabled: true,
  },
  "validate-api-key": {
    text: "Check connection",
    disabled: true,
  },
  "remove-api-key": {
    text: "Remove key",
    disabled: true,
  },
  "api-key-status": {},
  "api-key-hint": {
    text: "Stored securely in Windows Credential Manager. Checking the connection sends no recording. Dictation sends audio directly to OpenAI.",
  },
  "microphone-heading": {
    text: "Microphone",
  },
  "refresh-devices": {
    text: "Refresh devices",
  },
  microphone: {
    options: [
      {
        value: "",
        label: "System default microphone",
      },
    ],
  },
  "microphone-access-help": {
    text: "Microphone access is checked automatically. Allow access once when Windows asks.",
  },
  "prepare-microphone": {
    text: "Allow microphone",
  },
  "shortcut-heading": {
    text: "Dictation shortcut",
  },
  "shortcut-form": {},
  shortcut: {
    value: "Ctrl+Alt+F8",
  },
  "shortcut-record": {
    text: "Record shortcut",
  },
  "shortcut-capture-hint": {
    text: "Choose Record shortcut, then press and release your key combination to save it. Esc cancels.",
  },
  status: {
    text: "Registering shortcut…",
  },
  "preferences-heading": {
    text: "While you dictate",
  },
  "live-enabled": {
    checked: true,
  },
  "cleanup-enabled": {
    checked: true,
  },
  diagnostics: {},
  "hotkey-action": {
    value: "record",
    options: [
      {
        value: "record",
        label: "Dictate and insert",
      },
      {
        value: "live",
        label: "Live transcription test (no insertion)",
      },
      {
        value: "insert",
        label: "Text insertion test",
      },
    ],
  },
  "hold-state": {
    text: "UP",
  },
  "session-state": {
    text: "idle",
  },
  "input-level": {
    value: "0",
  },
  "input-level-status": {
    text: "Waiting for recording.",
  },
  "recording-status": {
    text: "Ready.",
  },
  "recording-metadata": {
    text: "No recording retained.",
  },
  "clear-recording": {
    text: "Clear captured audio",
    disabled: true,
  },
  "overlay-status": {},
  "live-latency": {
    text: "First visible text: waiting",
  },
  "test-text": {
    text: "BYOK dictation insertion probe",
  },
  "insertion-status": {
    text: "Choose Text insertion test to check a destination.",
  },
  "copy-text": {
    text: "Copy test text",
  },
  "copy-without-backup": {
    text: "Replace clipboard with test text",
  },
  "clear-log": {
    text: "Clear",
  },
  events: {},
  "apply-shortcut": {
    text: "Apply shortcut",
    hidden: true,
  },
  "api-key": {
    disabled: true,
  },
};
