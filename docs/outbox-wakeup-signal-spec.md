# Outbox Wakeup Signal — Design Spec

**Status:** Implemented 2026-10-23 in `7f3477c` (`src/outbox/wakeup-signal.ts`; `src/utils/channel.ts` deleted). All eight acceptance tests below are covered by `wakeup-signal.spec.ts` and `outbox-worker.service.spec.ts` (verified 2026-10-24: outbox suites 8/8, 57 tests pass).  
**Scope:** Replace the generic `Channel<T>` used only by `OutboxWorker` with a Node-appropriate, outbox-specific wakeup signal. This does not change the transactional outbox or move work out of the existing NestJS process architecture.

## Problem

`apps/backend/src/utils/channel.ts` implements a general-purpose bounded/unbounded producer-consumer channel: values, reads, writes, backpressure waits, availability waits, and completion. `OutboxWorker` uses only a capacity-one, non-durable “work may be available” signal. The actual work is persisted in PostgreSQL and claimed by `OutboxDispatcher`.

Porting the .NET channel surface gives this one Node.js use case more machinery than it needs. Node’s event loop, promises, timers, and `AbortSignal` are sufficient; this signal is not a work queue and does not need blocking readers, thread coordination, or producer backpressure.

## Goals

- Replace the general-purpose `Channel<T>` dependency with a small, specifically named wakeup-signal interface.
- Keep PostgreSQL as the source of truth; wakeups remain local, advisory, and non-durable.
- Keep idle database polling to **one fallback poll per process per interval**, independent of worker concurrency.
- Preserve configured dispatch concurrency when work is found, including when the process is a dedicated drainer whose producers are in another process.
- Bound signal state and clean up every waiter on notification, cancellation, or shutdown.
- Use only Node/Nest primitives already available; add no dependency.

## Non-goals

- Do not implement a general-purpose channel, queue, semaphore, or backpressure abstraction.
- Do not move durable work from PostgreSQL to memory or Redis.
- Do not add leader election, a broker, another worker deployment, or a new process role as part of this change.
- Do not change event ordering, retry/backoff, lease, or payment-reconciliation policy.

## Proposed interface

Use a small `WakeupSignal` owned by the outbox worker, either private to `OutboxWorker` or as a narrowly scoped helper in `src/outbox/`:

```ts
type WakeupWaitResult = "signaled" | "closed";

interface WakeupSignal {
  notify(): void; // wake every parked worker (producer commit, startup)
  notifyOne(): void; // wake one parked worker (fallback tick)
  notifyWaiters(): void; // wake parked workers only, never leave a pending bit
  wait(): Promise<WakeupWaitResult>;
  close(): void;
}
```

The implementation should use a coalescing pending flag and a set of promise waiters (no per-wait timers or abort listeners) (or an equally small Node-native mechanism). It should not expose generic `Reader<T>`/`Writer<T>` APIs or payload types: the signal has no payload.

## Behavioral contract

1. **Advisory signal only.** `notify()` means “check PostgreSQL”; it does not represent a row, a count, or durable work. Losing a process-local notification is safe because the fallback poll recovers committed rows.
2. **Coalescing.** If no caller is waiting, `notify()` sets one pending bit; further notifications coalesce until a waiter consumes it. If callers are waiting, one `notify()` resolves all of them and does not enqueue a pending token. Signal state is bounded to one pending bit plus the currently waiting callers; it never stores an event backlog.
3. **Broadcast to parked workers.** A notification with multiple workers waiting releases all those waiters so they can concurrently call `dispatchDue()`. `FOR UPDATE SKIP LOCKED` remains responsible for disjoint claims.
4. **Remember a busy-time notification.** If no worker is waiting because they are draining, retain one pending indication. A worker finishing its drain must observe it and run another drain instead of clearing and discarding it.
5. **Single idle fallback poller, independent of the workers.** One process-level timer (owned by `OutboxWorker`, not by any worker) ticks every poll interval and calls `notifyOne()`: one parked worker wakes and performs the fallback claim, or, if every worker is busy, one pending bit is left. No worker owns the heartbeat, so a worker stuck in a hung handler cannot stop polling for the process. The timer is `unref`'d and cleared on shutdown.
6. **Restore concurrency after fallback work is found.** When the fallback poller finds/claims due work, it must signal idle peers so the configured worker pool can help with remaining rows. The poller must not create a self-wakeup that causes an unnecessary extra empty claim. This also applies when the drainer is in a separate process from producers and therefore receives no producer-side event.
7. **Wait precedence.** `wait()` checks states in this order: closed → return `closed`; pending bit → consume it and return `signaled`; otherwise register a waiter. Because timeouts no longer live inside `wait()`, a fallback tick cannot leave an abandoned waiter behind: every waiter is released by a notification or by `close()`.
8. **Shutdown.** `close()` is idempotent, discards any pending bit, resolves all parked waiters as `closed`, and makes later `notify()` calls no-ops. The worker checks its running state after wakeup and does not start a new drain during shutdown.
9. **No blocking or busy loop.** Waiting is promise/timer based. An idle worker performs no polling work between its configured fallback ticks.

## Worker lifecycle

- Startup: start the configured workers, then notify the local pool once to drain pre-existing rows.
- Producer commit: the existing Nest event-emitter listener calls `notify()` after commit; the signal wakes parked workers but does not replace the database claim.
- Fallback: a process-level timer ticks every poll interval and wakes one worker (`notifyOne()`), which performs a database claim. An empty result returns it to waiting. A non-empty result wakes peers (`notifyWaiters()`) so they can claim other batches concurrently.
- Active drain: full batches continue draining immediately. Notifications arriving during a drain coalesce and cause at least one follow-up scan.
- Shutdown: stop accepting work, close the signal, let the existing in-flight dispatch grace period apply, and do not start another batch.

## Acceptance tests

Use the existing Jest setup and test the worker/signal behavior, not a .NET-compatible API surface:

1. With concurrency `N`, an idle interval causes exactly one fallback `dispatchDue()` call per process, not `N` calls.
2. A local producer wakeup wakes parked workers before the fallback interval.
3. A wakeup while all workers are draining causes a follow-up scan after work completes; repeated notifications coalesce and do not exceed configured in-flight concurrency.
4. A fallback poll that finds backlog activates idle peers and allows concurrent claims up to configured concurrency, including when no producer wakeup can cross the process boundary.
5. Repeated fallback ticks do not accumulate signal waiters, and the waiter set never exceeds the pool size.
6. A worker stuck in a handler that never returns does not stop the fallback: surviving workers keep claiming on every tick.
7. Shutdown releases parked workers, clears the fallback timer, and starts no new drain after stopping.
8. A closed signal returns `closed` to later waiters, ignores later notifications, and tolerates repeated `close()` calls.

Tests should prefer observable dispatch counts, in-flight concurrency, and shutdown completion. Avoid asserting a concrete private collection shape unless a focused low-level test needs to prove waiter cleanup and no public observation can establish that invariant.

## Trade-offs and evolution

A tiny signal is less reusable than `Channel<T>`, intentionally: there is one current use and no backpressure requirement. If a second real producer-consumer use appears, first check whether Node’s existing queue/stream or BullMQ already fits; only then consider a shared generic channel with multiple adapters and a separate spec. If wakeups ever need to cross process boundaries, PostgreSQL polling remains the correctness mechanism unless measured load justifies a durable notification mechanism.
