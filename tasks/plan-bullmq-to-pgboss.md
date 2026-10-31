# Plan: BullMQ (Redis) → pg-boss (Postgres)

Status: **proposal, nothing implemented** (re-checked 2026-10-24: `pg-boss` is not a dependency, and BullMQ still runs the `payments`, `chat-maintenance` and `entitlements` queues). Written 2026-10-14 from a read-through of the backend plus a local benchmark (numbers below are real runs, with the caveats listed).

## 1. What Redis actually does here

Redis serves three unrelated jobs. pg-boss can replace the first two only.

| #   | Role                                                     | Where                                                                           | pg-boss replaces it?               |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | BullMQ `payments` queue (3 job kinds, concurrency 5)     | `payment.module.ts`, `processors/payment.processor.ts`, 3 `*-outbox-handler.ts` | Yes                                |
| 2   | BullMQ `chat-maintenance` hourly attachment cleanup      | `chat-maintenance.processor.ts`                                                 | Yes                                |
| 3   | Chat realtime fan-out (Redis pub/sub, 2 ioredis conns)   | `chat-pubsub.service.ts`                                                        | **No** — not a queue; see §5       |
| —   | Throttler, idempotency, outbox, account purge, last-seen | all in-memory or Postgres already                                               | n/a                                |
| —   | `redis` npm package (v6.2.1)                             | no importer anywhere in `src/`                                                  | dead dependency, remove regardless |

**Structural finding:** the payment path is already `Postgres outbox (SKIP LOCKED, lease, backoff, dedupe_key) → BullMQ → PaymentProcessor`. The three outbox handlers do nothing but `queue.add()`. BullMQ is therefore a _second_ durable queue stacked on a first one, contributing: a bounded worker pool (5), per-job retry/backoff, and delayed jobs (Bakong poll loop). Swapping it for pg-boss keeps that shape (two Postgres queues in series); §6 Phase 5 is the way to remove the redundancy later.

## 2. Measured comparison

Harness: Node 22, `bullmq@6.3.14` vs `pg-boss@12.38.0`, local Docker (Redis 7 without AOF, Postgres 16, PgBouncer in transaction mode as a stand-in for Supabase's pooler). "+60 ms RTT" = a TCP proxy adding 30 ms each way, to imitate a cloud hop. Shape mirrors the app: 2 queues + 2 workers idle, payments concurrency 5, 150 jobs at 10/s for latency, 1000-job burst, 20 delayed jobs (3 s), 3-attempt retry.

| Config                                            | idle load         | pickup p50 / p95 (no added latency) | pickup p50 (+60 ms RTT) | burst (jobs/s)  | ops per job       | delayed-job lateness p50 |
| ------------------------------------------------- | ----------------- | ----------------------------------- | ----------------------- | --------------- | ----------------- | ------------------------ |
| **BullMQ**                                        | 4 cmds/s, 6 conns | 4 / 6 ms                            | 155 ms                  | 1650            | **34 Redis cmds** | 42 ms                    |
| pg-boss **defaults** (batch 1, conc 5, poll 2s)   | 4 tx/s, 9 conns   | 7.9 s / 13.9 s (**can't keep up**)  | —                       | **2.6**         | 1.9 tx            | 2.0 s                    |
| pg-boss batched, poll 2 s                         | 3 tx/s, 5 conns   | 1.0 s / 1.9 s                       | 1.09 s                  | 294             | 0.8 tx            | 1.3 s                    |
| pg-boss batched, poll 0.5 s                       | 5 tx/s, 2 conns   | 272 / 504 ms                        | 359 ms                  | 484             | 0.7 tx            | 0.29 s                   |
| pg-boss batched, **LISTEN/NOTIFY** + poll 0.5 s   | 4 tx/s, 13 conns  | **8 / 10 ms**                       | **160 ms**              | 516             | 1.1 tx            | 0.45 s                   |
| pg-boss batch 1 / conc 5, NOTIFY + poll 0.5 s     | 7 tx/s, 17 conns  | 9 / 12 ms                           | 159 ms                  | **13**          | 4.4 tx            | 1.5 s                    |
| pg-boss via PgBouncer (tx mode), batched poll 2 s | 2 tx/s, 3 conns   | 1.0 s / 1.9 s                       | 1.07 s                  | 303 (1000/1000) | 0.9 tx            | 1.3 s                    |

Correctness checks, identical on both: sending the same id three times ran the handler once; a 3-attempt retry ran exactly 3 times. Retry spacing differs (BullMQ 1 s, 2 s; pg-boss ≈2 s, 4 s for the same base, poll-aligned).

**Reading it honestly**

- Throughput is a non-issue at this app's volume (payments are a handful per minute). BullMQ is ~3–100× faster in raw jobs/s, and it does not matter.
- **Latency is the real trade.** BullMQ is push-based (~4 ms). pg-boss is poll-based unless LISTEN/NOTIFY is on, then it matches BullMQ (8 ms; 160 vs 155 ms at 60 ms RTT). NOTIFY needs a session-capable connection — **not** the Supabase transaction pooler on port 6543 that `DATABASE_URL` uses today. On 6543 you get 0.3–1 s pickup (poll interval), fine for the Bakong poll loop, noticeable on the first `process-attempt` if a customer is waiting on it.
- **pg-boss defaults are a trap.** `batchSize: 1` + `localConcurrency: 5` is capped by the poll tick (~2.5 jobs/s). Every pg-boss queue here must set its polling/batch options explicitly.
- Redis-side cost: 34 commands per job. Redis Cloud's free plan is 30 MB, 30 connections and a **100 ops/s** cap ([Redis docs](https://redis.io/docs/latest/operate/rc/subscriptions/view-essentials-subscription/essentials-plan-details/)), so if that cap is enforced, BullMQ sustains ≈3 jobs/s there (arithmetic from the measurement, not tested on your plan). Idle BullMQ is ~4 cmds/s ≈ 350k/day — irrelevant on Redis Cloud, material on per-command-billed hosts.
- Postgres-side cost: ~3–8 background transactions/s per instance at idle, plus 1–4 per job, plus table bloat that autovacuum must keep up with. It also adds ~2–17 connections per instance unless `max` is capped.

**Caveats:** single run per cell, local Docker (WSL2), PgBouncer ≠ Supavisor, simulated latency, Redis without AOF (Redis Cloud/compose persist, which slows it slightly). Treat as order-of-magnitude, not a guarantee. The harness lived in the session scratchpad and is not committed.

## 3. Recommendation

Do the migration, but in this order and with these constraints:

1. pg-boss for roles 1 and 2 — **hand-written ~100-line `QueueModule`/`PgBossService`**, no Nest wrapper package (AGENTS.md: no new packages without justification; this removes three: `bullmq`, `@nestjs/bullmq`, unused `redis`).
2. **Give pg-boss its own connection string** (`QUEUE_DATABASE_URL`, falling back to `DATABASE_URL`): Supabase session pooler (5432) or direct. That enables NOTIFY and avoids any transaction-pooler edge case. Cap its pool (`max: 4`).
3. Role 3 (chat pub/sub) is a separate decision — §5. Until then Redis stays, but only for 2 connections and a few publishes/s, which fits any free plan.
4. Do **not** collapse the outbox→queue hop in the same change (Phase 5, optional).

Trade-offs vs. staying on BullMQ: you lose ~4 ms push latency (recover it with NOTIFY), gain a queue that shares Postgres's durability/backup/transactions, and drop Redis from the payment-critical path. Path to evolve: Phase 5 (transactional enqueue), or back to a broker only if job volume outgrows what Postgres should carry.

## 4. Mapping

| BullMQ today                                                 | pg-boss                                                                                                                         | Gotcha                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| one `payments` queue, `job.name` switch                      | three queues: `payments.process-attempt`, `payments.process-provider-event`, `payments.poll-attempt` (+ `payments.dead-letter`) | queue-name charset to confirm in the spike                                                                                                          |
| `attempts: 3`                                                | `retryLimit: 2`                                                                                                                 | off-by-one: BullMQ counts tries, pg-boss counts retries                                                                                             |
| exponential `delay: 5000`                                    | `retryDelay: 5, retryBackoff: true, retryDelayMax`                                                                              | spacing differs and is poll-aligned (measured)                                                                                                      |
| `add(..., { jobId })` (idempotent)                           | `send(queue, data, { id })` — duplicate id is a no-op (measured)                                                                | id must be a UUID: `paymentAttemptId`, `paymentProviderEventId`, outbox `event.id` all are                                                          |
| `add(..., { delay: intervalMs })`                            | `startAfter` (seconds, round **up**)                                                                                            | lateness = poll interval (0.3–1.5 s measured)                                                                                                       |
| `@OnWorkerEvent('failed')` + `attemptsMade < attempts` guard | catch in the handler on last attempt (`retryCount >= retryLimit`) **and** a worker on `payments.dead-letter`                    | crash/expiry never reaches the handler; the DLQ worker is the backstop. `expireInSeconds` default is 15 min — set it above the slowest gateway call |
| `@Processor(queue, { concurrency })`                         | `work(queue, { localConcurrency, batchSize, pollingIntervalSeconds, ... })`                                                     | see §2: never leave defaults. A thrown error in a batch fails the whole batch                                                                       |
| `upsertJobScheduler({ every: 1h })`                          | `schedule('chat.attachments-cleanup', '0 * * * *')`                                                                             | cron granularity; dedup across instances is built in                                                                                                |
| `BullModule.forRootAsync` (Redis host/port/tls/prefix)       | `PgBossService` (connection string, `schema`, `max`, `supervise`/`schedule` flags)                                              | mirror `OUTBOX_WORKER_ENABLED` so an API-only instance doesn't supervise                                                                            |
| graceful close                                               | `boss.stop({ graceful: true, timeout })` in `OnApplicationShutdown`                                                             |                                                                                                                                                     |

## 5. Chat pub/sub (the part pg-boss cannot do)

Options, smallest first:

- **A. Driver switch** `CHAT_PUSH_DRIVER=local|redis`. `local` = in-process `EventEmitter` — correct for a single instance (what `docker-compose.yml` runs). Dev needs no Redis at all; hosted keeps Redis only if you run >1 instance. ~30 lines behind the existing `publish`/`onEvent` surface of `ChatPubSubService`.
- **B. Postgres LISTEN/NOTIFY.** Needs a session connection, and NOTIFY payloads are capped at 8000 bytes while `message` pushes carry the row (E2E ciphertext can be 24000 chars) — so it would have to send ids only and have recipients refetch. A real design change; do not couple it to this migration.
- **C. Keep Redis** for pub/sub only. Free plan limits are not a concern at this size.

Recommendation: **A**, defaulting to `local` for dev and any single-instance deploy, `redis` only when running more than one backend instance. Decide after Phase 3.

## 6. Phases

- **Phase 0 — spike (½ day, go/no-go).** Against a Supabase dev branch/DB (not prod): `start()` over 6543 vs 5432; confirm schema creation privileges, `migrate` behaviour, NOTIFY on the session pooler, queue-name charset, and re-run the harness pointed at it. **Gate:** pickup p50 < 1 s on whichever URL we will actually use.
- **Phase 1 — foundation.** `src/queue/` (`QueueModule`, `PgBossService`, config in `config.validation.ts`: `QUEUE_DATABASE_URL`, `QUEUE_POOL_MAX=4`, `QUEUE_SCHEMA=pgboss`, `QUEUE_LISTEN_NOTIFY`, `QUEUE_POLL_SECONDS=0.5`, `QUEUE_WORKER_ENABLED`). Short retention (`deleteAfterSeconds` ≈ 1–2 days — the outbox already keeps the audit trail). Unit tests use a fake `PgBossService`.
- **Phase 2 — chat-maintenance.** Lowest risk (hourly, idempotent, best-effort). Swap the scheduler/processor; `process` logic and its spec stay.
- **Phase 3 — payments.** Three outbox handlers `queue.add` → `send`; `PaymentProcessor` → three `work` registrations around the unchanged Effect `run()`; abandoned-job handling per §4. **Cutover must drain, not flip:** release N publishes new jobs to pg-boss while the BullMQ worker keeps draining old ones (no new adds); release N+1 removes BullMQ. Outbox rows are the source of truth, so a missed job is recoverable, but do not rely on that.
- **Phase 4 — Redis scope.** §5 decision; remove `bullmq`, `@nestjs/bullmq`, `redis`; make the compose `redis` service an opt-in profile; update CLAUDE.md (BullMQ/Redis sections, and the Node floor: pg-boss needs ≥22.12 while CLAUDE.md says ≥18 — `Dockerfile.vercel` is already Node 22).
- **Phase 5 (optional, later).** `send(..., { db: tx })` inside the domain transaction and delete the three forwarding outbox handlers. Trade-off: removes a hop and a failure mode, but moves retry/lease logic from the outbox into pg-boss for those events and needs a Drizzle→`executeSql` adapter.

## 7. Risks

1. **Transaction pooler (6543).** Source shows pg-boss uses only transaction-scoped advisory locks and no named prepared statements, and it ran clean through PgBouncer in transaction mode — but Supavisor is unverified, and NOTIFY is impossible there. Mitigation: own connection string (§3.2).
2. **Silent throughput/latency cliff** from pg-boss defaults (§2). Mitigation: explicit options per queue; a test asserting them.
3. **Semantic drift** — retry spacing, off-by-one attempts, UUID-only ids, batch-fails-together. All in §4; covered by Phase 3 tests.
4. **Single failure domain.** Outbox and queue now both live in Postgres; a DB outage stops both (a Redis outage today stops only the second). Payments already hard-depend on Postgres, so net exposure is small.
5. **DB load and bloat** on the shared Supabase instance; watch autovacuum and `pgboss.job` size.
6. **Upgrade cadence.** pg-boss ships frequent 12.x releases that auto-migrate on `start()`. Pin the version; consider `migrate: false` + an explicit deploy step so N instances don't race a migration.
7. **`drizzle-kit`:** `drizzle.config.ts` has no `schemaFilter`; the default (`public`) should ignore `pgboss`, same as the existing `payment`/`chat` schemas — confirm `db:push` does not propose dropping it.

## 8. Verify next

- Phase 0 spike results (above).
- Real production volume: payments/day and peak/min. If it is below ~1/s, polling-only at 0.5 s on 6543 is acceptable and NOTIFY is optional.
- Does a customer wait on `process-attempt`? If yes, NOTIFY (session URL) is worth having.
- Which Redis plan is actually billed today and what triggered the cost — the free plan is already $0, so the pain may be its 100 ops/s or connection limits rather than price. That changes whether Phase 4's pub/sub decision is urgent.

## 9. Addendum — switchable driver, Redis and BullMQ stay (decided 2026-10-14)

Instead of replacing BullMQ, put a seam in front of it and select the transport with `QUEUE_DRIVER=bullmq|memory|pgboss|outbox`. **Default `bullmq` = zero behaviour change; no Redis or BullMQ code is deleted.** Chat pub/sub (role 3) is untouched and keeps using Redis.

### Seam (three small pieces)

1. **`PaymentJobHandler`** — the transport-agnostic part of today's `PaymentProcessor`: the 3-way `switch`, the Effect `run()` bridge and `wakeupAfterCommit()`. Exposes `process(kind, data)` and `abandon(kind, data, error)`. The BullMQ `PaymentProcessor` becomes a thin caller (its `@OnWorkerEvent('failed')` keeps calling `abandon`), so the BullMQ path stays byte-for-byte equivalent in behaviour.
2. **`PaymentJobPublisher`** port: `publish(kind, data, { id, delaySeconds? })`. The three outbox handlers inject it instead of `@InjectQueue` (their published/retry logic is unchanged). Implementations: BullMQ (wraps the existing `Queue.add`), memory, pg-boss.
3. **Driver selection at module load** in `payment.module.ts` and `app.module.ts` (reads `process.env.QUEUE_DRIVER`, same precedent as `PAYMENT_WORKER_CONCURRENCY` at decoration time): `BullModule.forRootAsync` / `registerQueueAsync` / `PaymentProcessor` are only registered for `bullmq`, so other drivers open no queue connection to Redis. `PaymentModule` currently re-exports `BullModule` but nothing injects the queue outside it (checked), so that export becomes conditional.

Chat cleanup does **not** get three adapters: `cleanupOrphans` is a predicate-based, idempotent sweep, so non-BullMQ drivers use a timer sweeper like `AccountPurgeService`. Cost: it runs once per instance per hour instead of once cluster-wide (the select-then-delete is not claimed, so a double run is wasteful but harmless).

### Drivers

| Driver   | Durable | New dep | Poll-loop delay                | Concurrency isolation            | Use                                                                       |
| -------- | ------- | ------- | ------------------------------ | -------------------------------- | ------------------------------------------------------------------------- |
| `bullmq` | yes     | no      | native                         | worker pool (5)                  | current default                                                           |
| `memory` | **no**  | no      | `setTimeout`                   | in-process limiter (5)           | tests/dev only; **refuse to boot when `NODE_ENV=production`**             |
| `pgboss` | yes     | pg-boss | `startAfter`                   | `localConcurrency`               | candidate replacement (§2–§4)                                             |
| `outbox` | yes     | no      | needs `availableAt` on enqueue | outbox worker (sequential/batch) | cheapest durable option; the existing Postgres outbox runs the job itself |

**Why `memory` is test-only:** the outbox marks a row `published` as soon as `publish()` returns. If the container restarts (every Vercel deploy/scale event) the in-memory job is gone, the outbox will not resend it, and the payment attempt sits pending forever. It is safe for exercising the flow, not for real payments.

**`outbox` driver caveats:** today the poll handler forwards a _delayed_ job; inline it would need `IntegrationEvent` to accept a delay so the poll event is enqueued with `available_at = now() + interval` (small change, but it touches the shared outbox). The outbox lease is 60 s (`outbox.leaseTimeoutSeconds`) — a gateway call that outlives it would be re-claimed and double-run, and a batch is dispatched sequentially, so a slow gateway blocks the batch. Verify gateway timeouts before choosing it over pg-boss.

### Order

1. Characterisation specs for the extracted handler (payments has **no** processor/handler tests today — only provider-signing and ledger-balance specs), then the seam with `bullmq` default. Verify unchanged against the sandbox gateway.
2. `memory` driver (≈ one small class + one spec). Proves the seam and lets the whole flow run with no Redis queue.
3. `pgboss` (needs the Phase 0 spike from §6 first) **or** `outbox`, whichever the gateway-timeout check allows.
4. Same scenario under every driver: checkout → attempt → poll loop → settled notification, then kill the process mid-job (expect BullMQ/pg-boss/outbox to resume, memory to lose it).
5. Only afterwards decide whether to delete BullMQ and Redis (§6 Phase 4).

Config added: `QUEUE_DRIVER` (zod enum, default `bullmq`) now; `QUEUE_DATABASE_URL`, `QUEUE_POOL_MAX`, `QUEUE_LISTEN_NOTIFY` only with the pg-boss step.
