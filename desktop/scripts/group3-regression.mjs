// Deterministic Group 3 checks. Saved-key provider calls and native UI
// acceptance are deliberately separate so this command is safe to repeat.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = [
  "scripts/application-model.test.mjs",
  "scripts/audio-capture-worklet.test.mjs",
  "scripts/native-capture.test.mjs",
  "scripts/transcription-session.test.mjs",
  "scripts/live-transcription.test.mjs",
  "scripts/recovery-audit.test.mjs",
  "scripts/actionable-recovery.test.mjs",
  "scripts/provisional-recovery.test.mjs",
  "scripts/overlay.test.mjs",
  "scripts/api-key-privacy.test.mjs",
  "scripts/platform.test.mjs",
];

function run(label, command, args, cwd = root) {
  console.log(`\nGroup 3 regression: ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const platform of ["windows", "macos"]) {
  run(`${platform} shared logic`, process.execPath, [
    `--conditions=yapyap-${platform}`, "--experimental-transform-types", "--test", ...tests,
  ]);
}
run("native contracts", "cargo", ["test", "--lib", "--locked", "--offline"], `${root}src-tauri`);
// --quick limits the run to shared logic and native contracts.
const quick = process.argv.includes("--quick");
if (!quick) {
  run("rendered UI fixtures", process.execPath, ["scripts/run-ui-tests.mjs"]);
}
// Host primitives use disposable credentials, invalid fixture keys and, on Mac, a
// disposable aggregate microphone that is unplugged mid-capture: no saved key,
// paste, or billable provider request. The microphone probe needs the terminal's
// microphone permission.
if (process.argv.includes("--native-probes")) {
  const hostCredential = {
    darwin: [
      "credentials::tests::macos_keychain_lifecycle",
      "audio_capture::macos::tests::macos_native_capture_device_lifecycle",
    ],
    win32: ["credentials::tests::windows_credential_restart_probe"],
  }[process.platform] ?? [];
  run("host primitive probes", "cargo", [
    "test", "--lib", "--locked", "--offline", "--", "--ignored", "--exact", ...hostCredential,
    "openai::tests::openai_rejects_invalid_fixture_key",
    "transcription::tests::openai_rejects_invalid_transcription_key",
  ], `${root}src-tauri`);
}
if (!quick) {
  const python = process.env.YAPYAP_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  run("privacy scanner regressions", python, ["scripts/test-audit-key-leaks.py"]);
  run("key-pattern audit", python, ["scripts/audit-key-leaks.py"]);
}
