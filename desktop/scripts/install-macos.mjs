// Build, sign and install the single probe copy at /Applications/YapYap.app.
// macOS privacy grants follow the app's code requirement: ad-hoc builds change
// it on every rebuild, while a stable signing identity keeps grants valid.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const built = `${root}src-tauri/target/release/bundle/macos/YapYap.app`;
const installed = "/Applications/YapYap.app";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function must(command, args, options) {
  const result = run(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
}

function signingIdentity() {
  if (process.env.YAPYAP_SIGNING_IDENTITY) return process.env.YAPYAP_SIGNING_IDENTITY;
  // Keychain listing order varies, so prefer by kind: Developer ID requirements
  // follow the team and survive certificate renewal. Use the fingerprint, since
  // an expired certificate may share the valid one's name.
  const valid = run("security", ["find-identity", "-v", "-p", "codesigning"]).stdout ?? "";
  const identities = [...valid.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/gm)];
  const match = ["Developer ID Application:", "Apple Development:"]
    .map((kind) => identities.find((identity) => identity[2].startsWith(kind)))
    .find(Boolean) ?? identities[0];
  if (match) console.log(`Code-signing identity: ${match[2]}`);
  return match?.[1] ?? "-";
}

function runningPids() {
  const out = run("pgrep", ["-f", "YapYap.app/Contents/MacOS/yapyap"]).stdout ?? "";
  return out.split("\n").filter(Boolean);
}

const identity = signingIdentity();
console.log(identity === "-"
  ? "Signing ad hoc: macOS will ask for Accessibility and Keychain approval again after every install."
  : `Signing with "${identity}": privacy grants carry over between installs.`);

if (!process.argv.includes("--skip-build")) {
  must("npx", ["tauri", "build", "--config", "src-tauri/tauri.macos.conf.json", "--bundles", "app", "--ci"],
    { env: { ...process.env, APPLE_SIGNING_IDENTITY: identity } });
}
if (!existsSync(built)) {
  console.error(`No build found at ${built}.`);
  process.exit(1);
}

// Stopping clears the running session's in-memory audio and text.
for (const pid of runningPids()) run("kill", [pid]);
for (let attempt = 0; attempt < 50 && runningPids().length; attempt++) {
  run("sleep", ["0.1"]);
}
for (const pid of runningPids()) run("kill", ["-KILL", pid]);

rmSync(installed, { recursive: true, force: true });
must("ditto", [built, installed]);
must("codesign", ["--verify", "--deep", "--strict", installed]);
const signature = run("codesign", ["-dr", "-", installed]);
const requirement = `${signature.stdout}${signature.stderr}`.match(/designated => .*/)?.[0] ?? "";
console.log(`Installed ${installed}\n${requirement}`);
if (!process.argv.includes("--no-launch")) must("open", [installed]);
