import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/ui-tests",
  workers: 1,
  use: {
    baseURL: "http://localhost:1424",
    channel: "msedge",
    viewport: { width: 600, height: 640 },
    headless: true,
  },
  webServer: {
    command: "node scripts/recovery-rendered-fixture.mjs",
    url: "http://localhost:1424/recovery-fixture.html",
    env: { UI_FIXTURE_PORT: "1424" },
    reuseExistingServer: false,
  },
});
