import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { startVisiblePoller, type PollerEnv } from "./visible-poller.ts";

const INTERVAL = 20_000;

/** One shared "browser": tabs share the lock table, each has its own visibility. */
function createBrowser() {
  const holders = new Map<string, { owner: symbol; onGranted: () => void }[]>();
  const grant = (key: string) => {
    const queue = holders.get(key) ?? [];
    queue[0]?.onGranted();
  };
  return {
    tab() {
      const owner = Symbol("tab");
      let visible = true;
      const listeners = new Set<() => void>();
      const env: PollerEnv = {
        isVisible: () => visible,
        onVisibilityChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        requestLeadership(key, onGranted) {
          const queue = holders.get(key) ?? [];
          holders.set(key, queue);
          queue.push({ owner, onGranted });
          if (queue.length === 1) onGranted();
          return () => {
            const wasLeader = queue[0]?.owner === owner;
            const at = queue.findIndex((h) => h.owner === owner);
            if (at !== -1) queue.splice(at, 1);
            if (wasLeader) grant(key);
          };
        },
      };
      return {
        env,
        setVisible(next: boolean) {
          visible = next;
          listeners.forEach((l) => l());
        },
      };
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("startVisiblePoller", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("polls at once while visible, then every interval", async () => {
    const tab = createBrowser().tab();
    const run = mock.fn();
    const stop = startVisiblePoller({
      run,
      intervalMs: INTERVAL,
      env: tab.env,
    });

    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);

    mock.timers.tick(INTERVAL);
    await flush();
    assert.equal(run.mock.callCount(), 2);
    stop();
  });

  it("never polls while the tab is hidden, and catches up once when it returns", async () => {
    const tab = createBrowser().tab();
    tab.setVisible(false);
    const run = mock.fn();
    const stop = startVisiblePoller({
      run,
      intervalMs: INTERVAL,
      env: tab.env,
    });

    mock.timers.tick(INTERVAL * 10);
    await flush();
    assert.equal(run.mock.callCount(), 0);

    tab.setVisible(true);
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);
    stop();
  });

  it("stops polling when hidden and waits out the rest of the interval on return", async () => {
    const tab = createBrowser().tab();
    const run = mock.fn();
    const stop = startVisiblePoller({
      run,
      intervalMs: INTERVAL,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);

    mock.timers.tick(5_000);
    tab.setVisible(false);
    mock.timers.tick(INTERVAL * 5);
    await flush();
    assert.equal(run.mock.callCount(), 1, "no run while hidden");

    // Hidden far longer than an interval: returning catches up immediately.
    tab.setVisible(true);
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 2);

    // A quick hide/show inside the interval must not add an extra run.
    tab.setVisible(false);
    tab.setVisible(true);
    mock.timers.tick(INTERVAL - 1);
    await flush();
    assert.equal(run.mock.callCount(), 2);
    mock.timers.tick(1);
    await flush();
    assert.equal(run.mock.callCount(), 3);
    stop();
  });

  it("lets only one visible tab poll, and hands over when the leader hides", async () => {
    const browser = createBrowser();
    const a = browser.tab();
    const b = browser.tab();
    const runA = mock.fn();
    const runB = mock.fn();
    const stopA = startVisiblePoller({
      run: runA,
      intervalMs: INTERVAL,
      leaderKey: "sync",
      env: a.env,
    });
    const stopB = startVisiblePoller({
      run: runB,
      intervalMs: INTERVAL,
      leaderKey: "sync",
      env: b.env,
    });

    mock.timers.tick(0);
    await flush();
    assert.equal(runA.mock.callCount(), 1);
    assert.equal(runB.mock.callCount(), 0);

    mock.timers.tick(INTERVAL);
    await flush();
    assert.equal(runA.mock.callCount(), 2);
    assert.equal(runB.mock.callCount(), 0);

    a.setVisible(false);
    mock.timers.tick(0);
    await flush();
    assert.equal(runB.mock.callCount(), 1, "the other visible tab takes over");
    assert.equal(runA.mock.callCount(), 2, "the hidden tab stays quiet");
    stopA();
    stopB();
  });

  it("does not keep leadership while hidden", async () => {
    const browser = createBrowser();
    const a = browser.tab();
    const b = browser.tab();
    const stopA = startVisiblePoller({
      run: mock.fn(),
      intervalMs: INTERVAL,
      leaderKey: "sync",
      env: a.env,
    });
    const runB = mock.fn();
    const stopB = startVisiblePoller({
      run: runB,
      intervalMs: INTERVAL,
      leaderKey: "sync",
      env: b.env,
    });

    a.setVisible(false);
    mock.timers.tick(0);
    await flush();
    assert.equal(runB.mock.callCount(), 1);
    stopA();
    stopB();
  });

  it("stop() ends the loop, including a run that is still in flight", async () => {
    const tab = createBrowser().tab();
    let finish: () => void = () => {};
    const run = mock.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const stop = startVisiblePoller({
      run,
      intervalMs: INTERVAL,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);

    stop();
    finish();
    await flush();
    mock.timers.tick(INTERVAL * 5);
    await flush();
    assert.equal(run.mock.callCount(), 1);
  });

  it("keeps polling after a run throws or rejects", async () => {
    const tab = createBrowser().tab();
    let n = 0;
    const run = mock.fn(async () => {
      if (++n === 1) throw new Error("offline");
    });
    const stop = startVisiblePoller({
      run,
      intervalMs: INTERVAL,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();
    mock.timers.tick(INTERVAL);
    await flush();
    assert.equal(run.mock.callCount(), 2);
    stop();
  });
});

describe("startVisiblePoller realtime hints", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("re-reads a function interval every time it schedules", async () => {
    const tab = createBrowser().tab();
    let interval = 20_000;
    const run = mock.fn(() => {
      interval = 100_000;
    });
    const stop = startVisiblePoller({
      run,
      intervalMs: () => interval,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);

    mock.timers.tick(99_999);
    await flush();
    assert.equal(run.mock.callCount(), 1, "not at the old 20 s interval");
    mock.timers.tick(1);
    await flush();
    assert.equal(run.mock.callCount(), 2);
    stop();
  });

  it("retime() moves a pending slow timer to the new, faster interval", async () => {
    const tab = createBrowser().tab();
    let interval = 300_000;
    const run = mock.fn();
    const poller = startVisiblePoller({
      run,
      intervalMs: () => interval,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);

    mock.timers.tick(5_000);
    interval = 20_000; // the socket dropped: fall back to fast polling
    poller.retime();
    mock.timers.tick(14_999);
    await flush();
    assert.equal(run.mock.callCount(), 1);
    mock.timers.tick(1);
    await flush();
    assert.equal(run.mock.callCount(), 2, "20 s after the last run, not 300 s");
    poller();
  });

  it("poke() runs soon and coalesces a burst into one run", async () => {
    const tab = createBrowser().tab();
    const run = mock.fn();
    const poller = startVisiblePoller({
      run,
      intervalMs: 300_000,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);

    poller.poke();
    poller.poke();
    poller.poke();
    mock.timers.tick(250);
    await flush();
    assert.equal(run.mock.callCount(), 2);
    mock.timers.tick(10_000);
    await flush();
    assert.equal(run.mock.callCount(), 2, "one run for the whole burst");
    poller();
  });

  it("a poke that lands during a run is not swallowed", async () => {
    const tab = createBrowser().tab();
    let finish: () => void = () => {};
    let calls = 0;
    const run = mock.fn(() => {
      calls++;
      return calls === 1
        ? new Promise<void>((resolve) => (finish = resolve))
        : undefined;
    });
    const poller = startVisiblePoller({
      run,
      intervalMs: 300_000,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();
    assert.equal(run.mock.callCount(), 1);

    poller.poke(); // the first run may already have read stale data
    finish();
    await flush();
    mock.timers.tick(250);
    await flush();
    assert.equal(run.mock.callCount(), 2);
    poller();
  });

  it("poke() does nothing in a hidden tab or a tab that is not the leader", async () => {
    const browser = createBrowser();
    const leader = browser.tab();
    const follower = browser.tab();
    const runLeader = mock.fn();
    const runFollower = mock.fn();
    const a = startVisiblePoller({
      run: runLeader,
      intervalMs: 300_000,
      leaderKey: "sync",
      env: leader.env,
    });
    const b = startVisiblePoller({
      run: runFollower,
      intervalMs: 300_000,
      leaderKey: "sync",
      env: follower.env,
    });
    mock.timers.tick(0);
    await flush();
    assert.equal(runLeader.mock.callCount(), 1);

    b.poke();
    mock.timers.tick(1_000);
    await flush();
    assert.equal(runFollower.mock.callCount(), 0, "follower stays quiet");

    leader.setVisible(false);
    a.poke();
    mock.timers.tick(1_000);
    await flush();
    assert.equal(runLeader.mock.callCount(), 1, "hidden leader stays quiet");
    a();
    b();
  });

  it("poke({ ifOlderThanMs }) skips a run that just happened and runs a stale one", async () => {
    const tab = createBrowser().tab();
    const run = mock.fn();
    const poller = startVisiblePoller({
      run,
      intervalMs: 300_000,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();

    mock.timers.tick(500);
    poller.poke({ ifOlderThanMs: 2_000 });
    mock.timers.tick(1_000);
    await flush();
    assert.equal(run.mock.callCount(), 1, "fresh enough: skipped");

    mock.timers.tick(5_000);
    poller.poke({ ifOlderThanMs: 2_000 });
    mock.timers.tick(250);
    await flush();
    assert.equal(run.mock.callCount(), 2, "stale: runs");
    poller();
  });

  it("retime() does not push out a poke that is already waiting", async () => {
    const tab = createBrowser().tab();
    const run = mock.fn();
    const poller = startVisiblePoller({
      run,
      intervalMs: 300_000,
      env: tab.env,
    });
    mock.timers.tick(0);
    await flush();

    poller.poke();
    poller.retime();
    mock.timers.tick(250);
    await flush();
    assert.equal(run.mock.callCount(), 2);
    poller();
  });
});
