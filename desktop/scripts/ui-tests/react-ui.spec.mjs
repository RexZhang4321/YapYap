import { test, expect } from "@playwright/test";

test("Windows build keeps credential setup and omits Mac probe controls", async ({ page }) => {
  await ready(page);
  await expect(page.locator('[aria-label="macOS feasibility probe"]')).toHaveCount(0);
  await expect(page.locator("#shortcut-display")).toHaveText("Ctrl+Alt+F8");
  await page.locator("#open-settings").click();
  await expect(page.locator("#api-key")).toBeEnabled();
  await expect(page.locator("#api-key-hint")).toContainText("Windows Credential Manager");
  await page.locator("#diagnostics").evaluate(element => { element.open = true; });
  await expect(page.locator("#probe-overlay-show")).toHaveCount(0);
  await page.evaluate(async () => {
    window.__fixtureIPC.resetCalls();
    const { ui } = await import("/src/ui/store.ts");
    ui.dispatch("probe-overlay-show", "click", new Event("click"));
    ui.dispatch("probe-overlay-hide", "click", new Event("click"));
  });
  expect((await snapshot(page)).commands).not.toContain("update_overlay");
  expect((await snapshot(page)).commands).not.toContain("platform_info");
});

test("Mac build shows only the shell fixture and uses Mac labels", async ({ page }) => {
  await page.goto("http://localhost:1425/recovery-fixture.html");
  await expect(page.locator("#dictation-status")).toHaveText("Setup needed");
  await expect(page.locator('[aria-label="macOS feasibility probe"]')).toBeVisible();
  await expect(page.locator("#shortcut-display")).toHaveText("Control+Option+F8");
  await expect(page.locator(".app-footer")).toContainText("menu bar");
  await page.locator("#open-settings").click();
  await expect(page.locator("#api-key")).toBeDisabled();
  await expect(page.locator("#save-api-key")).toBeDisabled();
  await expect(page.locator("#shortcut")).toHaveValue("Control+Option+F8");
  await page.locator("#shortcut-form").evaluate(form => form.requestSubmit());
  await expect(page.locator("#status")).toHaveText("Shortcut saved: Control+Option+F8");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("byok-dictation-preferences")).shortcut)).toBe("Ctrl+Alt+F8");
  expect((await snapshot(page)).commands).not.toContain("has_api_key");
  expect((await snapshot(page)).commands).not.toContain("platform_info");
  await page.locator("#diagnostics").evaluate(element => { element.open = true; });
  await page.locator("#probe-overlay-show").click();
  await expect.poll(() => page.evaluate(() => window.__fixtureIPC.state.calls
    .filter(call => call.command === "update_overlay").at(-1)?.args.snapshot.phase)).toBe("recording");
  await page.locator("#probe-overlay-hide").click();
  await expect.poll(() => page.evaluate(() => window.__fixtureIPC.state.calls
    .filter(call => call.command === "update_overlay").at(-1)?.args.snapshot.phase)).toBe("hidden");
});

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

async function dictate(page, live = "immediate") {
  await page.evaluate(async live => {
    const { recorder } = window.__recoveryFixture;
    recorder.start = async () => {
      recorder.active = true;
      return "Fixture recording";
    };
    recorder.stop = async () => {
      recorder.active = false;
      return { samples: [new Float32Array(128)], sampleRate: 48000,
        channelCount: 1, frameCount: 128, deviceId: "fixture-mic", deviceLabel: "Fixture",
        durationSeconds: 128 / 48000 };
    };
    window.__fixtureIPC.state.cleanup = "immediate";
    window.__fixtureIPC.state.live = live;
    window.__recoveryFixture.shortcut("Pressed");
    await new Promise(resolve => setTimeout(resolve, 0));
    window.__recoveryFixture.shortcut("Released");
  }, live);
}

for (const fullAudio of [true, false]) {
  for (const cleanup of [true, false]) {
    test(`main app controls skip selected requests: full audio ${fullAudio}, cleanup ${cleanup}`, async ({ page }) => {
      await ready(page);
      await page.locator("#open-settings").click();
      await page.locator("#live-enabled").uncheck();
      await page.locator("#settings-close").click();
      await page.locator("#full-audio-enabled").setChecked(fullAudio);
      await page.locator("#main-cleanup-enabled").setChecked(cleanup);
      await dictate(page);
      await expect(page.locator("#dictation-status")).toHaveText("Inserted");
      const state = await snapshot(page);
      expect(state.commands.filter(command => command === "transcribe_recording")).toHaveLength(Number(fullAudio));
      expect(state.commands.filter(command => command === "cleanup_transcript")).toHaveLength(Number(cleanup));
      expect(state.commands.filter(command => command === "start_live_stream")).toHaveLength(Number(!fullAudio));
      expect(state.session.transcript).toBe(fullAudio ? original : provisional);
      expect(state.insertions).toHaveLength(1);
      expect(state.insertions[0].text).toBe(cleanup
        ? "Send 42 to user_id.\n你好 😀 https://example.test/a?q=2"
        : fullAudio ? original : provisional);
      if (cleanup) {
        expect(await page.evaluate(() => window.__fixtureIPC.state.calls
          .find(call => call.command === "cleanup_transcript").args.text)).toBe(fullAudio ? original : provisional);
      }
      if (!fullAudio) await expect(page.locator("#timing-transcription")).toHaveText("Skipped");
      if (!cleanup) await expect(page.locator("#timing-cleanup")).toHaveText("Skipped");
    });
  }
}

test("main phase controls persist and cleanup stays synchronized with settings", async ({ page }) => {
  await ready(page);
  await page.locator("#full-audio-enabled").uncheck();
  await page.locator("#main-cleanup-enabled").uncheck();
  await page.reload();
  await expect(page.locator("#full-audio-enabled")).not.toBeChecked();
  await expect(page.locator("#main-cleanup-enabled")).not.toBeChecked();
  await page.locator("#open-settings").click();
  await expect(page.locator("#cleanup-enabled")).not.toBeChecked();
  await expect(page.locator("#live-enabled")).toBeChecked();
  await expect(page.locator("#live-enabled")).toBeDisabled();
  await expect(page.locator("#live-enabled-help")).toContainText("required");
  await page.locator("#cleanup-enabled").check();
  await page.locator("#settings-close").click();
  await expect(page.locator("#main-cleanup-enabled")).toBeChecked();
});

test("live-only dictation waits for completion and retains recording on failure without an automatic upload", async ({ page }) => {
  await ready(page);
  await page.locator("#full-audio-enabled").uncheck();
  await page.locator("#main-cleanup-enabled").uncheck();
  await dictate(page, "pending");
  await expect(page.locator("#dictation-status")).toHaveText("Finishing live transcription…");
  await expect(page.locator("#full-audio-enabled")).toBeDisabled();
  await expect(page.locator("#main-cleanup-enabled")).toBeDisabled();
  await page.evaluate(() => window.__fixtureIPC.emitLive({ kind: "delta", itemId: "fixture-item", text: "Partial" }));
  expect((await snapshot(page)).insertions).toHaveLength(0);
  await page.evaluate(() => window.__fixtureIPC.emitLive({ kind: "error", code: "live_disconnected" }));
  await expect(page.locator("#dictation-alert-text")).toContainText("recording is kept");
  const failed = await snapshot(page);
  expect(failed.session.audioRetained).toBe(true);
  expect(failed.commands).not.toContain("transcribe_recording");
  expect(failed.insertions).toHaveLength(0);
  await page.locator("#transcribe-recording").click();
  await expect(page.locator("#dictation-status")).toHaveText("Inserted");
  expect((await snapshot(page)).commands.filter(command => command === "transcribe_recording")).toHaveLength(1);
});

test("dictation consumes application preferences even when presentation controls are changed directly", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const { ui } = await import("/src/ui/store.ts");
    const { application, recorder } = window.__recoveryFixture;
    application.setPreferences({ cleanup: false, live: false });
    application.updateReadiness({ selectedMicrophone: "chosen-input" });
    // Only an input event can request a settings change. Stale/tampered view
    // values must not alter the next session or its provider requests.
    ui.control("cleanup-enabled").checked = true;
    ui.control("live-enabled").checked = true;
    ui.control("microphone").value = "wrong-input";
    ui.control("hotkey-action").value = "live";
    recorder.start = async deviceId => {
      window.__chosenInput = deviceId;
      recorder.active = true;
      return "Fixture recording";
    };
    recorder.stop = async () => {
      recorder.active = false;
      return { samples: [new Float32Array(128)], sampleRate: 48000,
        channelCount: 1, frameCount: 128, deviceId: "chosen-input", deviceLabel: "Fixture",
        durationSeconds: 128 / 48000 };
    };
    window.__fixtureIPC.state.transcription = "immediate";
    window.__recoveryFixture.shortcut("Pressed");
    await Promise.resolve();
    window.__recoveryFixture.shortcut("Released");
  });
  await expect(page.locator("#dictation-status")).toHaveText("Inserted");
  const state = await snapshot(page);
  expect(state.commands.filter(command => command === "cleanup_transcript")).toHaveLength(0);
  expect(state.commands.filter(command => command === "start_live_stream")).toHaveLength(0);
  expect(state.insertions).toHaveLength(1);
  expect(state.insertions[0].text).toBe(original);
  expect(await page.evaluate(() => window.__chosenInput)).toBe("chosen-input");
  await page.locator("#open-settings").click();
  await expect(page.locator("#cleanup-enabled")).not.toBeChecked();
  await expect(page.locator("#live-enabled")).not.toBeChecked();
});

test("processing times update during requests, freeze on stop and clear on discard", async ({ page }) => {
  await ready(page);
  await expect(page.locator("#processing-timings")).toBeHidden();
  await seed(page, "startFinalStall");
  await expect(page.locator("#timing-transcription")).toContainText("running");
  await expect(page.locator("#timing-cleanup")).toHaveText("Skipped");
  const initial = await page.locator("#timing-transcription").textContent();
  await expect.poll(() => page.locator("#timing-transcription").textContent()).not.toBe(initial);
  await page.locator("#stop-waiting").click();
  await expect(page.locator("#timing-transcription")).toContainText("stopped");
  const frozen = await page.locator("#timing-transcription").textContent();
  await page.evaluate(() => window.__fixtureIPC.resolve("transcription", "Late response"));
  await expect(page.locator("#timing-transcription")).toHaveText(frozen);
  await page.locator("#discard-transcription").click();
  await expect(page.locator("#processing-timings")).toBeHidden();
});

test("completed timings remain visible and fit a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 430 });
  await ready(page);
  await page.evaluate(() => window.__recoveryFixture.startSuccessful());
  await expect(page.locator("#processing-timings")).toBeVisible();
  for (const stage of ["preparation", "transcription", "cleanup", "destination", "insertion", "total"]) {
    await expect(page.locator(`#timing-${stage}`)).toHaveText(/^\d+\.\d{2} s$/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

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
    "Open YapYap from the tray",
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
