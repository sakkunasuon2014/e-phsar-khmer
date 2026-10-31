import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catchUpConversations,
  type CatchUpDeps,
  type CatchUpMessage,
  type CatchUpOutcome,
} from "./catch-up.ts";

interface Msg extends CatchUpMessage {
  e2e: boolean;
}

const PAGE = 3;

/** A world of conversations, with the same newest-first paging as the API. */
function world(
  conversations: Record<string, Msg[]>,
  opts: {
    outcome?: (m: Msg) => CatchUpOutcome;
    failFetchFor?: string;
  } = {},
) {
  const cache = new Set<string>();
  const marks = new Map<string, string>();
  const decrypted: string[] = [];
  let fetches = 0;

  const deps: CatchUpDeps<Msg> = {
    async fetchPage(conversationId, cursor) {
      fetches += 1;
      if (conversationId === opts.failFetchFor) throw new Error("offline");
      // Newest first; the cursor is "how many newest messages were served".
      const newestFirst = [...conversations[conversationId]].reverse();
      const from = cursor === null ? 0 : Number(cursor);
      const items = newestFirst.slice(from, from + PAGE);
      const next = from + PAGE;
      return {
        // Page-internal order is deliberately scrambled: callers must not rely on it.
        items: [...items].reverse(),
        nextCursor: next < newestFirst.length ? String(next) : null,
      };
    },
    canDecrypt: (m) => m.e2e,
    hasPlaintext: async (id) => cache.has(id),
    async decrypt(m) {
      decrypted.push(m.id);
      const outcome = opts.outcome?.(m) ?? "ok";
      if (outcome === "ok") cache.add(m.id);
      return outcome;
    },
    getMark: async (c) => marks.get(c) ?? null,
    setMark: async (c, id) => void marks.set(c, id),
  };
  return {
    deps,
    cache,
    marks,
    decrypted,
    get fetches() {
      return fetches;
    },
  };
}

/** `n` messages m1..mn, oldest first, one minute apart. */
function thread(prefix: string, n: number, e2e = true): Msg[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    e2e,
  }));
}

describe("catchUpConversations", () => {
  it("decrypts every page oldest first", async () => {
    const w = world({ c: thread("m", 7) });
    const r = await catchUpConversations(["c"], w.deps);
    assert.deepEqual(w.decrypted, ["m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
    assert.equal(r.decrypted, 7);
    assert.equal(r.complete, true);
    assert.equal(w.marks.get("c"), "m7");
  });

  it("re-running decrypts nothing and stops at the first page", async () => {
    const w = world({ c: thread("m", 7) });
    await catchUpConversations(["c"], w.deps);
    const before = w.fetches;
    w.decrypted.length = 0;

    const r = await catchUpConversations(["c"], w.deps);
    assert.deepEqual(w.decrypted, []);
    assert.equal(r.decrypted, 0);
    assert.equal(w.fetches - before, 1);
  });

  it("only decrypts what arrived since the last run", async () => {
    const convo = thread("m", 4);
    const w = world({ c: convo });
    await catchUpConversations(["c"], w.deps);
    w.decrypted.length = 0;

    convo.push(
      ...thread("n", 2).map((m, i) => ({
        ...m,
        createdAt: new Date(Date.UTC(2026, 9, 2, 0, i)).toISOString(),
      })),
    );
    const r = await catchUpConversations(["c"], w.deps);
    assert.deepEqual(w.decrypted, ["n1", "n2"]);
    assert.equal(r.decrypted, 2);
    assert.equal(w.marks.get("c"), "n2");
  });

  it("resumes where an exhausted budget stopped it, still oldest first", async () => {
    const w = world({ c: thread("m", 5) });
    const first = await catchUpConversations(["c"], w.deps, {
      decryptBudget: 3,
    });
    assert.equal(first.complete, false);
    assert.deepEqual(w.decrypted, ["m1", "m2", "m3"]);
    assert.equal(w.marks.get("c"), "m3");

    w.decrypted.length = 0;
    const second = await catchUpConversations(["c"], w.deps);
    assert.equal(second.complete, true);
    assert.deepEqual(w.decrypted, ["m4", "m5"]);
  });

  it("does not spend budget on messages that are already cached", async () => {
    const w = world({ c: thread("m", 4) });
    w.cache.add("m1");
    w.cache.add("m2");
    const r = await catchUpConversations(["c"], w.deps, { decryptBudget: 2 });
    assert.equal(r.alreadyCached, 2);
    assert.equal(r.decrypted, 2);
    assert.equal(r.complete, true);
    assert.deepEqual(w.decrypted, ["m3", "m4"]);
  });

  it("keeps going after an unavailable or failed message", async () => {
    const w = world(
      { c: thread("m", 4) },
      {
        outcome: (m) =>
          m.id === "m2" ? "unavailable" : m.id === "m3" ? "failed" : "ok",
      },
    );
    const r = await catchUpConversations(["c"], w.deps);
    assert.deepEqual(w.decrypted, ["m1", "m2", "m3", "m4"]);
    assert.deepEqual(
      { ok: r.decrypted, un: r.unavailable, bad: r.failed },
      { ok: 2, un: 1, bad: 1 },
    );
    assert.equal(w.marks.get("c"), "m4");
  });

  it("looks only at the newest messages when there is no mark yet", async () => {
    const w = world({ c: thread("m", 10) });
    await catchUpConversations(["c"], w.deps, {
      maxMessagesPerConversation: 4,
    });
    assert.deepEqual(w.decrypted, ["m7", "m8", "m9", "m10"]);
  });

  it("skips rows it cannot decrypt (plaintext) but still moves the mark", async () => {
    const w = world({ c: [...thread("p", 2, false), ...thread("e", 1)] });
    const r = await catchUpConversations(["c"], w.deps);
    assert.deepEqual(w.decrypted, ["e1"]);
    assert.equal(r.decrypted, 1);
  });

  it("a conversation that cannot be fetched does not stop the others", async () => {
    const w = world(
      { a: thread("a", 2), b: thread("b", 2) },
      { failFetchFor: "a" },
    );
    const r = await catchUpConversations(["a", "b"], w.deps);
    assert.equal(r.fetchErrors, 1);
    assert.deepEqual(w.decrypted, ["b1", "b2"]);
    assert.equal(w.marks.has("a"), false);
    assert.equal(r.complete, true);
  });

  it("stops promptly when aborted and keeps the progress it made", async () => {
    const w = world({ c: thread("m", 5) });
    const controller = new AbortController();
    const inner = w.deps.decrypt;
    w.deps.decrypt = async (m) => {
      const out = await inner(m);
      if (m.id === "m2") controller.abort();
      return out;
    };
    const r = await catchUpConversations(["c"], w.deps, {
      signal: controller.signal,
    });
    assert.equal(r.complete, false);
    assert.deepEqual(w.decrypted, ["m1", "m2"]);
    assert.equal(w.marks.get("c"), "m2");
  });

  it("walks several conversations with one shared budget", async () => {
    const w = world({ a: thread("a", 2), b: thread("b", 3) });
    const r = await catchUpConversations(["a", "b"], w.deps, {
      decryptBudget: 4,
    });
    assert.deepEqual(w.decrypted, ["a1", "a2", "b1", "b2"]);
    assert.equal(r.complete, false);
    assert.equal(w.marks.get("a"), "a2");
    assert.equal(w.marks.get("b"), "b2");
  });
});
