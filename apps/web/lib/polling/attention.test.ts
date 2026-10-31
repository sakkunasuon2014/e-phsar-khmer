import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createAttentionTracker, type ActivityEnv } from "./attention.ts";

const IDLE = 60_000;

function fakeEnv() {
  const listeners = new Set<() => void>();
  const env: ActivityEnv = {
    onActivity(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    env,
    activity: () => listeners.forEach((l) => l()),
    watching: () => listeners.size,
  };
}

describe("createAttentionTracker", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("goes idle after the window with no activity", () => {
    const { env } = fakeEnv();
    const tracker = createAttentionTracker({ idleMs: IDLE, env });
    const changes: boolean[] = [];
    const off = tracker.onChange((idle) => changes.push(idle));

    mock.timers.tick(IDLE - 1);
    assert.deepEqual(changes, []);
    mock.timers.tick(1);
    assert.deepEqual(changes, [true]);
    assert.equal(tracker.isIdle(), true);
    off();
  });

  it("activity pushes the deadline out instead of going idle", () => {
    const { env, activity } = fakeEnv();
    const tracker = createAttentionTracker({ idleMs: IDLE, env });
    const changes: boolean[] = [];
    const off = tracker.onChange((idle) => changes.push(idle));

    mock.timers.tick(IDLE - 10_000);
    activity();
    mock.timers.tick(IDLE - 1); // past the original deadline, inside the new one
    assert.deepEqual(changes, []);
    mock.timers.tick(1);
    assert.deepEqual(changes, [true]);
    off();
  });

  it("comes back on the first activity after going idle, and can go idle again", () => {
    const { env, activity } = fakeEnv();
    const tracker = createAttentionTracker({ idleMs: IDLE, env });
    const changes: boolean[] = [];
    const off = tracker.onChange((idle) => changes.push(idle));

    mock.timers.tick(IDLE);
    activity();
    activity(); // further input while active is silent
    assert.deepEqual(changes, [true, false]);
    assert.equal(tracker.isIdle(), false);

    mock.timers.tick(IDLE);
    assert.deepEqual(changes, [true, false, true]);
    off();
  });

  it("only watches while somebody listens, and cleans up fully", () => {
    const { env, watching } = fakeEnv();
    const tracker = createAttentionTracker({ idleMs: IDLE, env });
    assert.equal(watching(), 0);

    const offA = tracker.onChange(() => {});
    const offB = tracker.onChange(() => {});
    assert.equal(watching(), 1, "one subscription to the page, not two");
    offA();
    assert.equal(watching(), 1);
    offB();
    assert.equal(watching(), 0);

    const late: boolean[] = [];
    const offC = tracker.onChange((idle) => late.push(idle));
    mock.timers.tick(IDLE - 1);
    assert.deepEqual(late, [], "the window restarts when listening restarts");
    offC();
  });
});
