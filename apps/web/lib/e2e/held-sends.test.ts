import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancel,
  DEFAULT_LIFETIME_MS,
  hold,
  list,
  release,
  releaseAll,
  type HeldSendDeps,
  type HeldSendRecord,
  type HeldSendStore,
} from "./held-sends.ts";

interface Payload {
  text: string;
}

/** In-memory store for tests; a later IndexedDB adapter implements the same interface. */
function memoryStore(): HeldSendStore<Payload> {
  const rows = new Map<string, HeldSendRecord<Payload>>();
  return {
    async put(record) {
      rows.set(record.clientMessageId, { ...record });
    },
    async get(clientMessageId) {
      return rows.get(clientMessageId) ?? null;
    },
    async delete(clientMessageId) {
      rows.delete(clientMessageId);
    },
    async list(recipientId) {
      const all = [...rows.values()];
      return recipientId === undefined
        ? all
        : all.filter((r) => r.recipientId === recipientId);
    },
    async setState(clientMessageId, state) {
      const row = rows.get(clientMessageId);
      if (row) rows.set(clientMessageId, { ...row, state });
    },
  };
}

/** A simple async mutex standing in for the real Web Locks API, so two
 * "tabs" racing `release()` for the same key are serialized the same way a
 * browser would serialize `navigator.locks.request`. */
function memoryClaim(): HeldSendDeps<Payload>["claim"] {
  const queues = new Map<string, Promise<unknown>>();
  return (key, fn) => {
    const prior = queues.get(key) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}

function makeDeps(
  overrides: Partial<HeldSendDeps<Payload>> = {},
): HeldSendDeps<Payload> & {
  store: HeldSendStore<Payload>;
  sendCalls: HeldSendRecord<Payload>[];
  setClock(ms: number): void;
} {
  const store = memoryStore();
  const sendCalls: HeldSendRecord<Payload>[] = [];
  let clock = Date.parse("2026-10-01T00:00:00.000Z");
  const deps: HeldSendDeps<Payload> = {
    store,
    now: () => clock,
    claim: memoryClaim(),
    async send(item) {
      sendCalls.push(item);
      return { ok: true };
    },
    ...overrides,
  };
  return Object.assign(deps, {
    store,
    sendCalls,
    setClock(ms: number) {
      clock = ms;
    },
  }) as HeldSendDeps<Payload> & {
    store: HeldSendStore<Payload>;
    sendCalls: HeldSendRecord<Payload>[];
    setClock(ms: number): void;
  };
}

function item(
  clientMessageId: string,
  recipientId = "bob",
): {
  clientMessageId: string;
  recipientId: string;
  payload: Payload;
} {
  return { clientMessageId, recipientId, payload: { text: clientMessageId } };
}

describe("held-sends", () => {
  it("holds when there are no devices yet", async () => {
    const deps = makeDeps({
      async send() {
        return { ok: false, reason: "no-recipient-keys" };
      },
    });
    await hold(deps, item("m1"));
    const items = await list(deps, "bob");
    assert.equal(items.length, 1);
    assert.equal(items[0]?.state, "held");
    assert.equal(items[0]?.clientMessageId, "m1");
  });

  it("releases when a device appears", async () => {
    const deps = makeDeps();
    // Pre-seed as held, as if an earlier `hold()` ran while there was no device.
    await deps.store.put({
      clientMessageId: "m1",
      recipientId: "bob",
      payload: { text: "hi" },
      createdAt: new Date(deps.now()).toISOString(),
      state: "held",
    });
    const result = await release(deps, "bob");
    assert.deepEqual(result.sent, ["m1"]);
    assert.equal(deps.sendCalls.length, 1);
    const items = await list(deps, "bob");
    assert.equal(items.length, 0);
  });

  it("releases once even if two tabs race (idempotent on clientMessageId)", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let sendStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const deps = makeDeps({
      async send(sendItem) {
        deps.sendCalls.push(sendItem);
        sendStarted();
        await gate;
        return { ok: true };
      },
    });
    await deps.store.put({
      clientMessageId: "m1",
      recipientId: "bob",
      payload: { text: "hi" },
      createdAt: new Date(deps.now()).toISOString(),
      state: "held",
    });

    const tabA = release(deps, "bob");
    const tabB = release(deps, "bob");
    // Wait until the (lock-serialized) first send actually starts, then let
    // it proceed, simulating the device becoming reachable mid-race.
    await started;
    releaseGate();
    const [resultA, resultB] = await Promise.all([tabA, tabB]);

    assert.equal(deps.sendCalls.length, 1);
    assert.deepEqual([...resultA.sent, ...resultB.sent], ["m1"]);
    const items = await list(deps, "bob");
    assert.equal(items.length, 0);
  });

  it("expires after 14 days into a visible 'not sent' state", async () => {
    const deps = makeDeps();
    const createdAt = new Date(deps.now()).toISOString();
    await deps.store.put({
      clientMessageId: "m1",
      recipientId: "bob",
      payload: { text: "hi" },
      createdAt,
      state: "held",
    });

    deps.setClock(Date.parse(createdAt) + DEFAULT_LIFETIME_MS - 1);
    let items = await list(deps, "bob");
    assert.equal(items[0]?.state, "held");

    deps.setClock(Date.parse(createdAt) + DEFAULT_LIFETIME_MS + 1);
    items = await list(deps, "bob");
    assert.equal(items.length, 1);
    assert.equal(items[0]?.state, "expired");

    // An expired item is visible, but no longer retried.
    const result = await release(deps, "bob");
    assert.deepEqual(result.sent, []);
    assert.equal(deps.sendCalls.length, 0);
  });

  it("keeps order per recipient", async () => {
    const deps = makeDeps();
    const base = Date.parse("2026-10-01T00:00:00.000Z");
    for (const [id, offset] of [
      ["m3", 2],
      ["m1", 0],
      ["m2", 1],
    ] as const) {
      await deps.store.put({
        clientMessageId: id,
        recipientId: "bob",
        payload: { text: id },
        createdAt: new Date(base + offset).toISOString(),
        state: "held",
      });
    }
    const result = await release(deps, "bob");
    assert.deepEqual(result.sent, ["m1", "m2", "m3"]);
    assert.deepEqual(
      deps.sendCalls.map((c) => c.clientMessageId),
      ["m1", "m2", "m3"],
    );
  });

  it("a send error other than 'no devices' is surfaced, not held", async () => {
    const deps = makeDeps({
      async send() {
        throw new Error("network down");
      },
    });
    await deps.store.put({
      clientMessageId: "m1",
      recipientId: "bob",
      payload: { text: "hi" },
      createdAt: new Date(deps.now()).toISOString(),
      state: "held",
    });

    await assert.rejects(release(deps, "bob"), /network down/);
    // Still held (not silently dropped, not mislabeled) so the caller can retry.
    const items = await list(deps, "bob");
    assert.equal(items[0]?.state, "held");
  });

  it("hold() is idempotent on clientMessageId (does not duplicate)", async () => {
    const deps = makeDeps({
      async send() {
        return { ok: false, reason: "no-recipient-keys" };
      },
    });
    await hold(deps, item("m1"));
    await hold(deps, item("m1"));
    const items = await list(deps, "bob");
    assert.equal(items.length, 1);
  });

  it("cancel() removes a held item regardless of state", async () => {
    const deps = makeDeps({
      async send() {
        return { ok: false, reason: "no-recipient-keys" };
      },
    });
    await hold(deps, item("m1"));
    await cancel(deps, "m1");
    const items = await list(deps, "bob");
    assert.equal(items.length, 0);
  });

  it("releaseAll() releases every recipient with held items", async () => {
    const deps = makeDeps();
    for (const recipientId of ["bob", "alice"]) {
      await deps.store.put({
        clientMessageId: `m-${recipientId}`,
        recipientId,
        payload: { text: "hi" },
        createdAt: new Date(deps.now()).toISOString(),
        state: "held",
      });
    }
    await releaseAll(deps);
    assert.equal((await list(deps, "bob")).length, 0);
    assert.equal((await list(deps, "alice")).length, 0);
    assert.equal(deps.sendCalls.length, 2);
  });
});

describe("recovery of an item left in `sending` by a tab that died mid-send", () => {
  it("release() retries it instead of leaving it stuck forever", async () => {
    const deps = makeDeps();
    await hold(deps, item("m1"));
    // The tab was killed after marking the item `sending` and before it settled.
    await deps.store.setState("m1", "sending");

    const result = await release(deps, "bob");

    assert.deepEqual(result.sent, ["m1"]);
    assert.equal(deps.sendCalls.length, 1);
    assert.equal(await deps.store.get("m1"), null);
  });

  it("keeps it held (not stuck) when the recipient still has no device", async () => {
    const deps = makeDeps({
      async send() {
        return { ok: false, reason: "no-recipient-keys" };
      },
    });
    await hold(deps, item("m1"));
    await deps.store.setState("m1", "sending");

    const result = await release(deps, "bob");

    assert.deepEqual(result.stillHeld, ["m1"]);
    assert.equal((await deps.store.get("m1"))?.state, "held");
  });

  it("an old `sending` item still expires into the visible state", async () => {
    const deps = makeDeps();
    await hold(deps, item("m1"));
    await deps.store.setState("m1", "sending");
    deps.setClock(
      Date.parse("2026-10-01T00:00:00.000Z") + DEFAULT_LIFETIME_MS + 1,
    );

    const listed = await list(deps, "bob");

    assert.equal(listed[0].state, "expired");
    assert.equal(deps.sendCalls.length, 0);
  });
});
