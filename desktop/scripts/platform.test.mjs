import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolvePlatform, platformAlias } from "../platform.config.mjs";
import * as windows from "../src/platform/platform.windows.ts";
import * as macos from "../src/platform/platform.macos.ts";
import * as unsupported from "../src/platform/platform.unsupported.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("build target selection honors Tauri's target, rejects conflicts and supports browser overrides", () => {
  const select = options => resolvePlatform({ target: null, override: null, ...options });
  assert.equal(select({ target: "windows", host: "darwin" }), "windows");
  assert.equal(select({ target: "darwin", host: "win32" }), "macos");
  assert.equal(select({ override: "windows", host: "darwin" }), "windows");
  assert.equal(select({ host: "darwin" }), "macos");
  assert.equal(select({ host: "linux" }), "unsupported");
  assert.throws(() => select({ target: "windows", override: "macos" }), /conflicts/);
  assert.throws(() => select({ override: "typo" }), /must be/);
  assert.throws(() => platformAlias("typo"), /Unknown/);
});

test("selected modules preserve platform labels, supported features and canonical shortcut inputs", () => {
  assert.equal(windows.supportsCredentialStorage, true);
  assert.equal(windows.showOverlayFixture, false);
  assert.equal(windows.platformNotice, null);
  assert.match(windows.credentialHint, /Windows Credential Manager/);
  assert.equal(windows.pasteShortcut, "Ctrl+V");
  assert.equal(macos.supportsCredentialStorage, true);
  assert.match(macos.credentialHint, /macOS Keychain/);
  assert.equal(macos.showOverlayFixture, true);
  assert.equal(macos.platformNotice.title, "macOS feasibility probe");
  assert.equal(macos.pasteShortcut, "Command+V");
  const canonical = "Ctrl+Alt+Super+F8";
  assert.equal(macos.formatShortcut(canonical), "Control+Option+Command+F8");
  assert.equal(windows.formatShortcut(canonical), "Ctrl+Alt+Windows+F8");
  assert.equal(unsupported.supportsCredentialStorage, false);
  assert.equal(unsupported.showOverlayFixture, false);
  for (const implementation of [windows, macos, unsupported]) {
    for (const code of ["__proto__", "constructor", "private-fixture-marker"])
      assert.equal(implementation.credentialErrorMessage(code), undefined);
    assert.match(implementation.credentialErrorMessage("credential_platform_unsupported"), /unavailable/);
  }
});

test("Node conditions select the same named modules for non-bundled tests", () => {
  for (const target of ["windows", "macos", "unsupported"]) {
    const result = spawnSync(process.execPath, [
      "--experimental-transform-types", `--conditions=yapyap-${target}`, "--input-type=module", "-e",
      'import { platformName, pasteShortcut } from "#platform"; process.stdout.write(JSON.stringify({ platformName, pasteShortcut }));',
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).platformName, target);
  }
});

test("both entry points bundle only their selected platform, with no capability-query IPC", async () => {
  for (const target of ["windows", "macos"]) {
    const result = await build({
      configFile: false, root, plugins: [react()],
      resolve: { alias: platformAlias(target) }, logLevel: "silent",
      build: { write: false, rollupOptions: { input: { main: `${root}index.html`, overlay: `${root}overlay.html` } } },
    });
    const chunks = result.output.filter(item => item.type === "chunk");
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    assert.ok(modules.some(id => id.endsWith(`platform.${target}.ts`)));
    assert.ok(!modules.some(id => /platform\.(windows|macos|unsupported)\.ts$/.test(id) && !id.endsWith(`platform.${target}.ts`)));
    const source = chunks.map(chunk => chunk.code).join("\n");
    assert.equal(source.includes("platform_info"), false);
    if (target === "windows") {
      for (const marker of ["macOS feasibility probe", "macOS System Settings", "Keychain", "End of overlay check"])
        assert.equal(source.includes(marker), false, `${marker} must not ship in the Windows frontend`);
    } else {
      assert.equal(source.includes("Windows Credential Manager"), false);
      assert.ok(source.includes("macOS feasibility probe"));
    }
  }
});
