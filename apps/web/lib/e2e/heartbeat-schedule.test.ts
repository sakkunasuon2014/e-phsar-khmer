import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEARTBEAT_INTERVAL_MS,
  isHeartbeatDue,
  runHeartbeatIfDue,
  type HeartbeatScheduleDeps,
} from "./heartbeat-schedule.ts";

function makeDeps(lastRunAt: number | null, nowMs: number) {
  let last = lastRunAt;
  let now = nowMs;
  const deps: HeartbeatScheduleDeps = {
    getLastRunAt: () => last,
    setLastRunAt: (ms) => {
      last = ms;
    },
    now: () => now,
  };
  return {
    deps,
    getLast: () => last,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("heartbeat schedule", () => {
  it("is not due before the interval elapses", () => {
    const start = Date.parse("2026-10-27T00:00:00.000Z");
    const { deps } = makeDeps(start, start + HEARTBEAT_INTERVAL_MS - 1);
    assert.equal(isHeartbeatDue(deps), false);
  });

  it("is due once the interval has elapsed", () => {
    const start = Date.parse("2026-10-27T00:00:00.000Z");
    const { deps } = makeDeps(start, start + HEARTBEAT_INTERVAL_MS);
    assert.equal(isHeartbeatDue(deps), true);
  });

  it("has never run yet: due immediately", () => {
    const { deps } = makeDeps(null, Date.now());
    assert.equal(isHeartbeatDue(deps), true);
  });

  it("is due after a long hidden gap (far past the interval)", () => {
    const start = Date.parse("2026-10-27T00:00:00.000Z");
    const longGap = HEARTBEAT_INTERVAL_MS * 10;
    const { deps } = makeDeps(start, start + longGap);
    assert.equal(isHeartbeatDue(deps), true);
  });

  it("runs when due and records the run", async () => {
    const start = Date.parse("2026-10-27T00:00:00.000Z");
    const { deps, getLast } = makeDeps(start, start + HEARTBEAT_INTERVAL_MS);
    let calls = 0;
    const ran = await runHeartbeatIfDue(deps, async () => {
      calls += 1;
    });
    assert.equal(ran, true);
    assert.equal(calls, 1);
    assert.equal(getLast(), start + HEARTBEAT_INTERVAL_MS);
  });

  it("never runs more than once per window, even called back to back", async () => {
    const start = Date.parse("2026-10-27T00:00:00.000Z");
    const { deps } = makeDeps(start, start + HEARTBEAT_INTERVAL_MS);
    let calls = 0;
    const work = async () => {
      calls += 1;
    };
    const firstRan = await runHeartbeatIfDue(deps, work);
    const secondRan = await runHeartbeatIfDue(deps, work);
    assert.equal(firstRan, true);
    assert.equal(secondRan, false);
    assert.equal(calls, 1);
  });

  it("records the run before awaiting slow work, so a concurrent call in the same window does not also fire", async () => {
    const start = Date.parse("2026-10-27T00:00:00.000Z");
    const { deps } = makeDeps(start, start + HEARTBEAT_INTERVAL_MS);
    let calls = 0;
    let releaseWork: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    const slowWork = async () => {
      calls += 1;
      await gate;
    };

    const first = runHeartbeatIfDue(deps, slowWork);
    // Fires while the first run's work is still pending.
    const second = await runHeartbeatIfDue(deps, slowWork);
    releaseWork();
    const firstRan = await first;

    assert.equal(firstRan, true);
    assert.equal(second, false);
    assert.equal(calls, 1);
  });

  it("a new window after a run is due again", () => {
    const start = Date.parse("2026-10-27T00:00:00.000Z");
    const { deps, advance } = makeDeps(start, start);
    assert.equal(isHeartbeatDue(deps), false);
    advance(HEARTBEAT_INTERVAL_MS);
    assert.equal(isHeartbeatDue(deps), true);
  });
});
