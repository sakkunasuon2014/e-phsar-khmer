/**
 * Collapse consecutive "unavailable" messages (no envelope for this device —
 * see `decrypt-message.ts`) into one run, so a long gap renders one notice
 * with a count instead of one identical note per bubble (finding H-5).
 *
 * Readable messages (decrypted, own sends, or even "failed") pass through
 * unchanged and split a run in two. Order is preserved: every input message
 * appears in exactly one output node, in its original position. Which
 * messages count as "unavailable" is entirely up to the caller's predicate —
 * an own-sent row that is unavailable groups exactly like a peer's.
 */

export interface UnavailableRun<M> {
  kind: "unavailable-run";
  /** Messages in this run, in input order. */
  messages: M[];
  count: number;
}

export interface SingleMessage<M> {
  kind: "message";
  message: M;
}

export type UnavailabilityNode<M> = UnavailableRun<M> | SingleMessage<M>;

export function groupUnavailable<M>(
  messages: readonly M[],
  isUnavailable: (message: M) => boolean,
): UnavailabilityNode<M>[] {
  const nodes: UnavailabilityNode<M>[] = [];
  let i = 0;
  while (i < messages.length) {
    const current = messages[i];
    if (!isUnavailable(current)) {
      nodes.push({ kind: "message", message: current });
      i += 1;
      continue;
    }
    const run: M[] = [current];
    let j = i + 1;
    while (j < messages.length && isUnavailable(messages[j])) {
      run.push(messages[j]);
      j += 1;
    }
    nodes.push({ kind: "unavailable-run", messages: run, count: run.length });
    i = j;
  }
  return nodes;
}
