import type { DefaultJobOptions } from 'bullmq';

/**
 * How long BullMQ keeps finished jobs in Redis. Without this every job ever
 * run stays there forever (~1 KB each): the two housekeeping schedulers alone
 * leak ~170 KB/day, and one Bakong checkout left open used to write up to 75
 * poll jobs (the since-retired BullMQ poll chain) — which is what filled the
 * free 30 MB Redis Cloud database.
 *
 * Postgres is the record (`payment_attempts`, `outbox_events`, the tables the
 * jobs act on), so a finished job is only worth keeping for debugging. Failed
 * jobs are kept longer because they are the ones someone investigates.
 * `age` is in seconds; `count` caps the set per queue. BullMQ trims on every
 * job completion/failure, so a backlog written before this setting drains on
 * its own as new jobs finish.
 */
export const JOB_RETENTION: Pick<
  DefaultJobOptions,
  'removeOnComplete' | 'removeOnFail'
> = {
  removeOnComplete: { age: 24 * 60 * 60, count: 500 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 500 },
};

/**
 * Cap on each queue's `<prefix>:<queue>:events` stream (BullMQ default:
 * 10,000 entries). Nothing here consumes it — there is no `QueueEvents`
 * listener and no `job.waitUntilFinished()` — so it is pure storage; a short
 * tail is kept for ad-hoc inspection.
 */
export const EVENTS_STREAM_MAX_LEN = 500;
