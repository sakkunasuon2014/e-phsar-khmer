import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionForPush, E2E_PUSH } from "./push-events.ts";

const ME = "device-me";
const OTHER = "device-other";

describe("actionForPush", () => {
  it("pulls when another device uploaded", () => {
    assert.equal(
      actionForPush(
        { type: E2E_PUSH.backupUpdated, data: { deviceId: OTHER } },
        ME,
      ),
      "pull-backup",
    );
  });

  it("ignores this device's own upload", () => {
    assert.equal(
      actionForPush(
        { type: E2E_PUSH.backupUpdated, data: { deviceId: ME } },
        ME,
      ),
      null,
    );
  });

  it("treats a hint with missing data as coming from elsewhere", () => {
    assert.equal(
      actionForPush({ type: E2E_PUSH.backupUpdated, data: {} }, ME),
      "pull-backup",
    );
    assert.equal(
      actionForPush({ type: E2E_PUSH.backupUpdated }, ME),
      "pull-backup",
    );
  });

  it("ignores every other notification, such as payments", () => {
    assert.equal(
      actionForPush(
        { type: "payment.succeeded", data: { paymentTransactionId: "p1" } },
        ME,
      ),
      null,
    );
    assert.equal(actionForPush({ type: "follow.created" }, ME), null);
  });
});
