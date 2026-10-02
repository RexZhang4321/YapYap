import assert from "node:assert/strict";
import { test } from "node:test";
import { apiKeyErrorMessage, clearAndSubmitApiKey } from "../src/apiKey.ts";

test("unknown IPC errors and inherited object properties cannot reach the UI", () => {
  const marker = "sk-proj-" + "C".repeat(48);
  for (const error of [marker, "__proto__", "constructor", "toString", { message: marker }]) {
    const message = apiKeyErrorMessage(error);
    assert.equal(typeof message, "string");
    assert.equal(message.includes(marker), false);
    assert.equal(message, "The API-key operation could not be completed. Try again.");
  }
  assert.match(apiKeyErrorMessage("validation_unauthorized"), /rejected/);
});

test("secret field is cleared before an IPC call that throws", () => {
  const input = { value: "disposable-privacy-test-marker" };
  assert.throws(() => clearAndSubmitApiKey(input, () => {
    assert.equal(input.value, "");
    throw new Error("fixture invocation failed");
  }), /fixture invocation failed/);
  assert.equal(input.value, "");
});

test("secret field remains cleared after a rejected IPC request", async () => {
  const input = { value: "disposable-privacy-test-marker" };
  await assert.rejects(clearAndSubmitApiKey(input, async () => {
    assert.equal(input.value, "");
    throw new Error("fixture request failed");
  }), /fixture request failed/);
  assert.equal(input.value, "");
});
