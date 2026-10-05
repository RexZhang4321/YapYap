import assert from "node:assert/strict";
import test from "node:test";
import { createUiStore } from "../src/ui/store.ts";

test("React snapshots stay stable until a change and do not mutate previously published values", async () => {
  const ui = createUiStore();
  const initial = ui.snapshot("transcript");
  assert.equal(ui.snapshot("transcript"), initial);
  let notifications = 0;
  const unsubscribe = ui.subscribe(() => {
    notifications++;
  });
  ui.control("transcript").value = "Original text";
  ui.control("copy-transcript").disabled = false;
  const updated = ui.snapshot("transcript");
  assert.notEqual(updated, initial);
  assert.equal(initial.value, "");
  assert.equal(updated.value, "Original text");
  await Promise.resolve();
  assert.equal(notifications, 1);
  ui.control("transcript").value = "Original text";
  await Promise.resolve();
  assert.equal(notifications, 1);
  unsubscribe();
  ui.control("transcript").value = "New session";
  await Promise.resolve();
  assert.equal(notifications, 1);
  assert.equal(updated.value, "Original text");
});

test("modal flush publishes the latest exact review text before native showModal", async () => {
  const ui = createUiStore();
  const seen = [];
  ui.subscribe(() => seen.push(ui.snapshot("recovery-confirm-text").value));
  ui.control("recovery-confirm-text").value = "你好 😀\nExact original";
  ui.flush();
  assert.deepEqual(seen, ["你好 😀\nExact original"]);
  await Promise.resolve();
  assert.equal(seen.length, 1);
});

test("retained render snapshots are independent of later session mutations", () => {
  const ui = createUiStore();
  const results = [
    { sessionId: "one", transcript: "original", outputText: "cleaned" },
  ];
  ui.setRetained(results, false);
  const snapshot = ui.retained();
  results[0].transcript = "changed";
  results.length = 0;
  assert.equal(snapshot.results[0].transcript, "original");
  assert.equal(snapshot.results.length, 1);
  ui.setRetained([], true);
  assert.equal(snapshot.locked, false);
});

test("disposing a React navigation binding prevents duplicate actions after remount", () => {
  const ui = createUiStore();
  let opens = 0;
  const cleanup = ui.on("open-settings", "click", () => {
    opens++;
  });
  cleanup();
  ui.on("open-settings", "click", () => {
    opens++;
  });
  ui.dispatch("open-settings", "click", new Event("click"));
  assert.equal(opens, 1);
});
