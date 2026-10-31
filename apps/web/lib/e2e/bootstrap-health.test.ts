import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBootstrapError,
  getBootstrapHealth,
  recordBootstrapFailure,
  recordBootstrapSuccess,
  shouldShowBootstrapNotice,
  subscribeBootstrapHealth,
} from "./bootstrap-health.ts";

const domError = (name: string) =>
  Object.assign(new Error(`${name} happened`), { name });

test("classifies IndexedDB and quota problems as storage", () => {
  assert.equal(
    classifyBootstrapError(domError("QuotaExceededError")),
    "storage",
  );
  assert.equal(classifyBootstrapError(domError("SecurityError")), "storage");
  assert.equal(
    classifyBootstrapError(domError("InvalidStateError")),
    "storage",
  );
  const missing = Object.assign(
    new Error("E2E requires a browser with IndexedDB"),
    { name: "E2eBootstrapError" },
  );
  assert.equal(classifyBootstrapError(missing), "storage");
});

test("classifies a failed registration as server, anything else as unknown", () => {
  const reg = Object.assign(new Error("device registration failed: 500"), {
    name: "E2eBootstrapError",
  });
  assert.equal(classifyBootstrapError(reg), "server");
  assert.equal(
    classifyBootstrapError(new TypeError("fetch failed")),
    "unknown",
  );
  assert.equal(classifyBootstrapError("weird"), "unknown");
});

test("shows the notice only after repeated failures, and clears on success", () => {
  recordBootstrapSuccess();
  let notified = 0;
  const stop = subscribeBootstrapHealth(() => {
    notified += 1;
  });

  recordBootstrapFailure(domError("SecurityError"));
  assert.equal(shouldShowBootstrapNotice(getBootstrapHealth()), false);
  recordBootstrapFailure(domError("SecurityError"));
  assert.deepEqual(getBootstrapHealth(), { failures: 2, kind: "storage" });
  assert.equal(shouldShowBootstrapNotice(getBootstrapHealth()), true);

  recordBootstrapSuccess();
  assert.equal(shouldShowBootstrapNotice(getBootstrapHealth()), false);
  assert.equal(notified, 3);

  // A success while already healthy is not a change.
  recordBootstrapSuccess();
  assert.equal(notified, 3);
  stop();
});
