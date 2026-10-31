import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupUnavailable,
  type UnavailabilityNode,
} from "./group-unavailable.ts";

interface Msg {
  id: string;
  senderId: string;
  unavailable: boolean;
}

function msg(id: string, senderId: string, unavailable: boolean): Msg {
  return { id, senderId, unavailable };
}

const isUnavailable = (m: Msg) => m.unavailable;

/** Node "shape" for terse assertions: a message id, or a run's count. */
function shapes(nodes: UnavailabilityNode<Msg>[]): Array<string | number> {
  return nodes.map((n) => (n.kind === "message" ? n.message.id : n.count));
}

describe("groupUnavailable", () => {
  it("passes a thread with no unavailable messages through unchanged", () => {
    const input = [msg("1", "a", false), msg("2", "b", false)];
    const nodes = groupUnavailable(input, isUnavailable);
    assert.deepEqual(nodes, [
      { kind: "message", message: input[0] },
      { kind: "message", message: input[1] },
    ]);
  });

  it("merges a run of consecutive unavailable messages with a count", () => {
    const input = [
      msg("1", "a", true),
      msg("2", "b", true),
      msg("3", "a", true),
    ];
    const nodes = groupUnavailable(input, isUnavailable);
    assert.equal(nodes.length, 1);
    assert.deepEqual(nodes[0], {
      kind: "unavailable-run",
      messages: input,
      count: 3,
    });
  });

  it("splits two runs apart with a readable message in between", () => {
    const input = [
      msg("1", "a", true),
      msg("2", "b", true),
      msg("3", "a", false),
      msg("4", "b", true),
    ];
    const nodes = groupUnavailable(input, isUnavailable);
    assert.deepEqual(shapes(nodes), [2, "3", 1]);
  });

  it("groups own-sent unavailable rows the same way as any other sender", () => {
    const input = [
      msg("1", "me", true),
      msg("2", "me", true),
      msg("3", "peer", true),
    ];
    const nodes = groupUnavailable(input, isUnavailable);
    assert.equal(nodes.length, 1);
    assert.equal((nodes[0] as { count: number }).count, 3);
  });

  it("keeps output order the same as input order", () => {
    const input = [
      msg("1", "a", false),
      msg("2", "a", true),
      msg("3", "a", true),
      msg("4", "a", false),
      msg("5", "a", true),
    ];
    const nodes = groupUnavailable(input, isUnavailable);
    assert.deepEqual(shapes(nodes), ["1", 2, "4", 1]);
  });

  it("returns nothing for an empty thread", () => {
    assert.deepEqual(groupUnavailable([], isUnavailable), []);
  });
});
