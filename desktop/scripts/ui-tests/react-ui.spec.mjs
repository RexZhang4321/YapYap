import { test, expect } from "@playwright/test";

const original =
  "Original words: send 42 to user_id\n你好 😀 https://example.test/a?q=2";
const provisional = "Provisional, possibly incomplete words 17 😀";
async function ready(page, query = "") {
  await page.goto(`/recovery-fixture.html${query}`);
  await expect(page.locator("#dictation-status")).toHaveText(
    query ? "Setup needed" : "Ready to dictate",
  );
}
async function seed(page, name) {
  await page.evaluate((name) => window.__recoveryFixture[name](), name);
  await expect(page.locator("#recovery-panel")).toBeVisible();
}
async function snapshot(page) {
  return page.evaluate(() => window.__recoveryFixture.snapshot());
}

test("insertion refusal explains the reason and shortcut retry pastes saved output at a newly captured target", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    window.__fixtureIPC.state.insertion = { pasteAttempted: false, pasteSent: false,
      clipboardRestored: false, message: "Pointer moved; text was kept for Copy." };
    await window.__recoveryFixture.startSuccessful();
  });
  await expect(page.locator("#dictation-alert-text")).toContainText("Pointer moved");
  await expect(page.locator("#dictation-alert-text")).toContainText("Focus your intended text field");
  await page.evaluate(() => {
    window.__fixtureIPC.state.insertion = undefined;
    window.__recoveryFixture.shortcut("Pressed");
    window.__recoveryFixture.shortcut("Pressed");
  });
  expect((await snapshot(page)).insertions).toHaveLength(1);
  await expect(page.locator("#dictation-status")).toHaveText("Release to paste saved text");
  await page.evaluate(() => {
    window.__recoveryFixture.shortcut("Released");
    window.__recoveryFixture.shortcut("Released");
  });
  await expect(page.locator("#dictation-status")).toHaveText("Inserted");
  await expect(page.locator("#dictation-alert")).toBeHidden();
  const state = await snapshot(page);
  expect(state.insertions).toHaveLength(2);
  expect(state.insertions[1]).toEqual(state.insertions[0]);
  expect(state.commands.filter(command => command === "capture_dictation_target")).toHaveLength(2);
  expect(state.commands.filter(command => command === "transcribe_recording")).toHaveLength(1);
  expect(state.commands.filter(command => command === "cleanup_transcript")).toHaveLength(1);
});

test("shortcut cannot repeat a paste with an uncertain outcome", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    window.__fixtureIPC.state.insertion = { pasteAttempted: true, pasteSent: false,
      clipboardRestored: true, message: "Paste outcome is uncertain." };
    await window.__recoveryFixture.startSuccessful();
    window.__recoveryFixture.shortcut("Pressed");
    window.__recoveryFixture.shortcut("Released");
  });
  await expect(page.locator("#dictation-alert-text")).toContainText("paste outcome is uncertain");
  const state = await snapshot(page);
  expect(state.insertions).toHaveLength(1);
  expect(state.commands.filter(command => command === "capture_dictation_target")).toHaveLength(1);
  expect(state.session.transcript).toBe(original);
});

test("settings focus, controlled preferences, shortcut capture, and narrow layout", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await expect(page.locator("#live-panel")).toBeHidden();
  await expect(page.locator("#recovery-panel")).toBeHidden();
  await page.locator("#open-settings").click();
  await expect(page.locator("#settings-close")).toBeFocused();
  await expect(page.locator("#diagnostics")).not.toHaveAttribute("open", "");
  await page.locator("#cleanup-enabled").uncheck();
  await page.locator("#live-enabled").uncheck();
  await page.locator("#shortcut-record").click();
  await expect(page.locator("#shortcut")).toHaveValue("Press your shortcut…");
  await page.keyboard.press("Escape");
  await expect(page.locator("#shortcut")).toHaveValue("Ctrl+Alt+F8");
  await page.locator("#shortcut-record").click();
  await page.keyboard.press("Control+Alt+KeyJ");
  await expect(page.locator("#shortcut")).toHaveValue("Ctrl+Alt+J");
  await page.locator("#settings-close").click();
  await page.reload();
  await expect(page.locator("#dictation-status")).toHaveText(
    "Ready to dictate",
  );
  await expect(page.locator("#shortcut-display")).toHaveText("Ctrl+Alt+J");
  await page.setViewportSize({ width: 380, height: 430 });
  await page.locator("#open-settings").click();
  await expect(page.locator("#cleanup-enabled")).not.toBeChecked();
  await expect(page.locator("#live-enabled")).not.toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("#settings-dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("setup focuses the secret draft and clears it before saving", async ({
  page,
}) => {
  await ready(page, "?key=missing");
  await page.locator("#open-setup").click();
  await expect(page.locator("#api-key")).toBeFocused();
  await page.locator("#api-key").fill("disposable-privacy-test-marker");
  await expect(page.locator("#save-api-key")).toBeEnabled();
  const secretInState = await page.evaluate(async () => {
    const { ui } = await import("/src/ui/store.ts");
    return ui.snapshot("api-key").value;
  });
  expect(secretInState).toBe("");
  await page.locator("#save-api-key").click();
  await expect(page.locator("#api-key")).toHaveValue("");
  await expect(page.locator("#api-key-stored-status")).toHaveAttribute(
    "data-state",
    "saved",
  );
  await page.locator("#settings-close").click();
  await expect(page.locator("#dictation-status")).toHaveText(
    "Ready to dictate",
  );
});

test("rejecting a recovery dialog keeps processing and has no clipboard or paste effects", async ({
  page,
}) => {
  await ready(page);
  await seed(page, "startCleanupStall");
  await page.locator("#bypass-processing").click();
  await expect(page.locator("#recovery-confirm-text")).toHaveValue(original);
  await expect(page.locator("#recovery-confirm-cancel")).toBeFocused();
  await page.locator("#recovery-confirm-cancel").click();
  await expect(page.locator("#recovery-confirm-dialog")).not.toBeVisible();
  const state = await snapshot(page);
  expect(state.session.busy).toBe(true);
  expect(state.copies).toEqual([]);
  expect(state.insertions).toEqual([]);
});

test("confirming the exact original stops cleanup, copies once, and ignores a late result", async ({
  page,
}) => {
  await ready(page);
  await seed(page, "startCleanupStall");
  await page.locator("#open-settings").click();
  await expect(page.locator("#api-key")).toBeDisabled();
  await expect(page.locator("#remove-api-key")).toBeDisabled();
  await page.locator("#settings-close").click();
  await page.locator("#bypass-processing").click();
  await expect(page.locator("#recovery-confirm-text")).toHaveValue(original);
  await page.locator("#recovery-confirm-copy").click();
  await expect(page.locator("#copy-status")).toContainText(
    "Original transcript copied",
  );
  await page.evaluate(() =>
    window.__fixtureIPC.resolve("cleanup", "Late cleanup must be ignored"),
  );
  const state = await snapshot(page);
  expect(state.session.busy).toBe(false);
  expect(state.session.cleanedTranscript).toBeNull();
  expect(state.copies).toEqual([{ text: original, withoutBackup: false }]);
  expect(state.insertions).toEqual([]);
  await expect(page.locator("#transcript")).toHaveValue(original);
});

test("provisional recovery stays separate and keeps full audio for retry", async ({
  page,
}) => {
  await ready(page);
  await seed(page, "startFinalStall");
  await page.locator("#bypass-processing").click();
  await expect(page.locator("#recovery-confirm-text")).toHaveValue(provisional);
  await expect(page.locator("#recovery-confirm-warning")).toContainText(
    "not the final transcript",
  );
  await page.locator("#recovery-confirm-copy").click();
  await expect(page.locator("#provisional-copy-status")).toContainText(
    "Provisional live words copied",
  );
  const state = await snapshot(page);
  expect(state.session.transcript).toBe("");
  expect(state.session.audioRetained).toBe(true);
  expect(state.copies).toEqual([{ text: provisional, withoutBackup: false }]);
  expect(state.insertions).toEqual([]);
});

test("failed dictation discard returns to readiness and clears recovery", async ({
  page,
}) => {
  await ready(page);
  await seed(page, "startProviderError");
  await expect(page.locator("#dictation-status")).toHaveText(
    "Dictation needs attention",
  );
  await expect(page.locator("#transcribe-recording")).toBeEnabled();
  await page.locator("#discard-transcription").click();
  await expect(page.locator("#dictation-status")).toHaveText(
    "Ready to dictate",
  );
  await expect(page.locator("#recovery-panel")).toBeHidden();
  expect((await snapshot(page)).session.audioRetained).toBe(false);
});

test("retained originals preserve expanded rows and focus across subsequent dictations", async ({
  page,
}) => {
  await ready(page);
  await seed(page, "startSuccessful");
  await seed(page, "startSuccessful");
  const row = page.locator("#retained-results details").first();
  await row.locator("summary").click();
  await row.locator("textarea").focus();
  const sessionId = await row.getAttribute("data-session-id");
  await seed(page, "startSuccessful");
  const preserved = page.locator(`[data-session-id="${sessionId}"]`);
  await expect(preserved).toHaveAttribute("open", "");
  await expect(preserved.locator("textarea")).toBeFocused();
  await expect(preserved.locator("textarea")).toHaveValue(original);
  await expect(page.locator("#retained-results details")).toHaveCount(2);
  await preserved.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator("#retained-results details")).toHaveCount(1);
  await expect(page.locator("#retained-results summary")).toBeFocused();
});

test("overlay renders literal text, ignores stale revisions, scrolls to the tail, and clears on hide", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const callbacks = new Map();
    let sequence = 0,
      handler;
    window.__overlayFixture = {
      receive(snapshot) {
        callbacks.get(handler)?.({
          event: "overlay-state",
          id: 1,
          payload: snapshot,
        });
      },
    };
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {
        const id = ++sequence;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      invoke(command, args) {
        if (command === "plugin:event|listen") {
          handler = args.handler;
          return Promise.resolve(1);
        }
        if (
          command === "overlay_snapshot" &&
          location.search.includes("snapshot=failed")
        )
          return Promise.reject("fixture_snapshot_unavailable");
        if (command === "overlay_snapshot")
          return Promise.resolve({
            epoch: 1,
            revision: 0,
            phase: "hidden",
            text: "",
            preview: "off",
            hasGap: false,
          });
        return Promise.resolve();
      },
    };
  });
  await page.goto("/overlay.html");
  await expect(page.locator("#overlay-title")).toHaveText("Ready to dictate");
  const text = "你好 😀 <img src=x onerror=alert(1)>\n".repeat(40);
  await page.evaluate(
    (text) =>
      window.__overlayFixture.receive({
        epoch: 1,
        revision: 2,
        phase: "recording",
        text,
        preview: "listening",
        hasGap: false,
      }),
    text,
  );
  await expect(page.locator("#overlay-text")).toHaveText(text);
  await expect(page.locator("#overlay-text img")).toHaveCount(0);
  expect(
    await page
      .locator("#overlay-text")
      .evaluate(
        (element) =>
          element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
      ),
  ).toBe(true);
  await page.evaluate(() =>
    window.__overlayFixture.receive({
      epoch: 1,
      revision: 1,
      phase: "error",
      text: "Stale",
      preview: "failed",
      hasGap: true,
    }),
  );
  await expect(page.locator("#overlay")).toHaveAttribute(
    "data-phase",
    "recording",
  );
  await page.evaluate(() =>
    window.__overlayFixture.receive({
      epoch: 1,
      revision: 3,
      phase: "hidden",
      text: "",
      preview: "off",
      hasGap: false,
    }),
  );
  await expect(page.locator("#overlay-text")).toHaveText("");
  await expect(page.locator("#overlay")).toHaveAttribute(
    "data-phase",
    "hidden",
  );
  await page.goto("/overlay.html?snapshot=failed");
  await expect(page.locator("#overlay-title")).toHaveText(
    "Open Dictation from the tray",
  );
  await page.evaluate(() =>
    window.__overlayFixture.receive({
      epoch: 1,
      revision: 1,
      phase: "recording",
      text: "Recovered preview",
      preview: "listening",
      hasGap: false,
    }),
  );
  await expect(page.locator("#overlay-title")).toHaveText("Listening");
  await expect(page.locator("#overlay-text")).toHaveText("Recovered preview");
});
