import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createRecoveryFixtureServer } from "./recovery-rendered-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
test("browser fixtures cannot invalidate modules served to the native overlay", async () => {
  const target = resolve(root, "src-tauri/target");
  await mkdir(target, { recursive: true });
  const temporary = await mkdtemp(join(target, "vite-cache-test-"));
  const client = await createServer({
    root,
    configFile: resolve(root, "vite.config.ts"),
    cacheDir: join(temporary, "client"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  let fixture;
  function url(server, path) {
    return `http://127.0.0.1:${server.httpServer.address().port}${path}`;
  }
  async function eventModule(server) {
    const response = await fetch(url(server, "/src/overlay.tsx"));
    assert.equal(response.status, 200);
    const source = await response.text();
    const path = source.match(
      /["']([^"']*@tauri-apps_api_event\.js[^"']*)["']/,
    )?.[1];
    assert.ok(path, "overlay imports the optimized native event module");
    return path;
  }
  try {
    await client.listen();
    const originalModule = await eventModule(client);
    const originalResponse = await fetch(url(client, originalModule));
    assert.equal(originalResponse.status, 200);
    const originalSource = await originalResponse.text();

    fixture = await createRecoveryFixtureServer(0);
    assert.notEqual(
      fixture.config.cacheDir,
      resolve(root, "node_modules/.vite"),
      "the fixture must also be isolated from the normal Tauri dev server's default cache",
    );
    assert.notEqual(fixture.config.cacheDir, client.config.cacheDir);
    await fixture.listen();
    const fixtureModule = await eventModule(fixture);
    assert.equal((await fetch(url(fixture, fixtureModule))).status, 200);

    for (const stopFixture of [false, true]) {
      if (stopFixture) await fixture.close();
      const response = await fetch(url(client, originalModule));
      assert.equal(
        response.status,
        200,
        "the client's original module URL remains valid",
      );
      assert.equal(await response.text(), originalSource);
    }
  } finally {
    await fixture?.close();
    await client.close();
    // Only remove this test's newly created directory inside the workspace target.
    assert.ok(resolve(temporary).startsWith(target + sep));
    await rm(temporary, { recursive: true, force: true });
  }
});
