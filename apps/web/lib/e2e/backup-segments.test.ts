import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openSegments } from "./backup-segments.ts";

/** Stand-in for `openSegment(bk, ciphertext)`: "bad:*" cannot be opened. */
function open(ciphertext: string): string[] {
  if (ciphertext.startsWith("bad:")) throw new Error("wrong key");
  return ciphertext.split(",");
}

describe("openSegments", () => {
  it("returns the items of every readable segment, in order", () => {
    const r = openSegments([{ ciphertext: "a,b" }, { ciphertext: "c" }], open);
    assert.deepEqual(r, { items: ["a", "b", "c"], skipped: 0 });
  });

  it("skips a wrong-key segment between two good ones and keeps both", () => {
    const r = openSegments(
      [{ ciphertext: "a" }, { ciphertext: "bad:1" }, { ciphertext: "c" }],
      open,
    );
    assert.deepEqual(r, { items: ["a", "c"], skipped: 1 });
  });

  it("skips a corrupt segment at the end without losing earlier ones", () => {
    const r = openSegments(
      [{ ciphertext: "a" }, { ciphertext: "bad:x" }],
      open,
    );
    assert.deepEqual(r, { items: ["a"], skipped: 1 });
  });

  it("counts every unreadable segment, even when all of them are", () => {
    const r = openSegments(
      [{ ciphertext: "bad:1" }, { ciphertext: "bad:2" }],
      open,
    );
    assert.deepEqual(r, { items: [], skipped: 2 });
  });

  it("returns nothing for an empty page", () => {
    assert.deepEqual(openSegments([], open), { items: [], skipped: 0 });
  });
});
