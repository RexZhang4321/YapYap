// Own the fixture in this process: Playwright's shell-launched Windows server
// can hang during teardown even after all assertions have passed.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRecoveryFixtureServer } from "./recovery-rendered-fixture.mjs";

const server = await createRecoveryFixtureServer(1424);
let result = 1;
try {
  await server.listen();
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)),
    "test", ...process.argv.slice(2),
  ], {
    stdio: "inherit",
    env: { ...process.env, YAPYAP_UI_EXTERNAL_SERVER: "1" },
  });
  result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await server.close();
}
process.exitCode = result;
