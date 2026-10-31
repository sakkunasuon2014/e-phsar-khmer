import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { outboxEvents } from '../db/schema/outbox.schema';
import type { OutboxEventRow } from '../db/schema/outbox.schema';
import { OUTBOX_WAKEUP_EVENT } from './outbox-events';
import type { DbExecutor, IntegrationEvent } from './outbox.types';

/**
 * Every read and write against `outbox_events`.
 *
 * All timestamps come from `now()` rather than the Node clock: rows are
 * claimed by comparing `available_at` to the database's clock, so writing
 * a JS `Date` into it would make backoff depend on how far each app
 * instance's clock has drifted from Postgres.
 */
@Injectable()
export class OutboxService {
  /** Lease attribution — shows up in `locked_by` for debugging a stuck row. */
  readonly instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Records an integration event. Pass the transaction that is performing
   * the domain write as `executor` — the event is only durable, and only
   * visible to a dispatcher, if it commits with that write.
   */
  async enqueue<TPayload>(
    executor: DbExecutor,
    event: IntegrationEvent<TPayload>,
  ): Promise<OutboxEventRow> {
    const maxAttempts =
      event.maxAttempts ??
      this.configService.get<number>('outbox.maxAttempts') ??
      5;

    const [row] = await executor
      .insert(outboxEvents)
      .values({
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        dedupeKey: event.dedupeKey,
        payload: event.payload,
        maxAttempts,
      })
      .onConflictDoNothing({ target: outboxEvents.dedupeKey })
      .returning();

    if (row) {
      return row;
    }

    // No row back means the dedupe key collided — someone already enqueued
    // this exact event. Return theirs so the caller still has an id to
    // dispatch against. Only a keyed enqueue can land here.
    const [existing] = event.dedupeKey
      ? await executor
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.dedupeKey, event.dedupeKey))
          .limit(1)
      : [];

    if (!existing) {
      throw new Error(
        `Failed to enqueue outbox event ${event.eventType} for ${event.aggregateType}:${event.aggregateId}`,
      );
    }

    return existing;
  }

  /**
   * Wakes the worker pool after the producer's transaction has committed.
   *
   * Must be called *after* the transaction commits, never inside it: a wakeup
   * emitted before commit could send a worker looking for a row that is not
   * visible yet. The signal is local and non-durable; the poll fallback is
   * the safety net for a lost wakeup.
   */
  wakeupAfterCommit(): void {
    this.eventEmitter.emit(OUTBOX_WAKEUP_EVENT);
  }

  /**
   * Claims up to `limit` rows that are due, marking them `processing` under
   * this instance's lease.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes this safe to run from every app
   * instance at once: a row already being claimed elsewhere is stepped over
   * rather than waited on, so dispatchers never queue behind each other.
   */
  claimDue(limit: number): Promise<OutboxEventRow[]> {
    return this.claim(this.dueCondition(), limit);
  }

  /**
   * Claims one specific event, if it is still unclaimed and due.
   *
   * Returns `undefined` when a worker got there first — the caller has
   * nothing to do, which is exactly the guarantee that keeps the inline
   * send path from double-delivering.
   */
  async claimById(eventId: string): Promise<OutboxEventRow | undefined> {
    const [row] = await this.claim(
      and(eq(outboxEvents.id, eventId), this.dueCondition())!,
      1,
    );
    return row;
  }

  /**
   * Milliseconds (by the database's clock) until the earliest row becomes
   * claimable: a pending row's `available_at`, or a stale lease's expiry.
   * `0` means something is due now; `null` means nothing is waiting at all.
   *
   * One aggregate query over the (usually tiny) set of unfinished rows. This
   * is what lets the worker sleep until work exists instead of polling a
   * fixed interval: idle cost is one of these per heartbeat, not a claim
   * attempt every couple of seconds.
   */
  async msUntilNextDue(): Promise<number | null> {
    const leaseSeconds =
      this.configService.get<number>('outbox.leaseTimeoutSeconds') ?? 60;

    const [row] = await this.db
      .select({
        ms: sql<string | number | null>`floor(extract(epoch from (
          min(
            case
              when ${outboxEvents.status} = 'pending' then ${outboxEvents.availableAt}
              else ${outboxEvents.lockedAt} + make_interval(secs => ${leaseSeconds})
            end
          ) - now()
        )) * 1000)`,
      })
      .from(outboxEvents)
      .where(sql`${outboxEvents.status} in ('pending', 'processing')`);

    // numeric comes back from postgres.js as a string.
    const ms = row?.ms == null ? Number.NaN : Number(row.ms);
    return Number.isFinite(ms) ? Math.max(0, ms) : null;
  }

  async markPublished(
    eventId: string,
    redactedPayload?: unknown,
  ): Promise<void> {
    await this.db
      .update(outboxEvents)
      .set({
        status: 'published',
        publishedAt: sql`now()`,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        ...(redactedPayload === undefined ? {} : { payload: redactedPayload }),
      })
      .where(eq(outboxEvents.id, eventId));
  }

  /** Returns the row to `pending`, invisible to claims until the backoff passes. */
  async markRetry(
    eventId: string,
    lastError: string,
    delayMs: number,
  ): Promise<void> {
    await this.db
      .update(outboxEvents)
      .set({
        status: 'pending',
        availableAt: sql`now() + make_interval(secs => ${delayMs / 1000})`,
        lockedAt: null,
        lockedBy: null,
        lastError,
      })
      .where(eq(outboxEvents.id, eventId));
  }

  async markFailed(
    eventId: string,
    lastError: string,
    redactedPayload?: unknown,
  ): Promise<void> {
    await this.db
      .update(outboxEvents)
      .set({
        status: 'failed',
        lockedAt: null,
        lockedBy: null,
        lastError,
        ...(redactedPayload === undefined ? {} : { payload: redactedPayload }),
      })
      .where(eq(outboxEvents.id, eventId));
  }

  /**
   * Deletes up to `limit` `published` rows whose `published_at` is older than
   * `olderThanDays`, returning how many went. Only `published` — a `failed`
   * row is a dead letter an operator still needs to see (and `markFailed`
   * never stamps `published_at`, so age isn't even defined for one).
   *
   * `skip locked` lets every instance sweep at once without queueing behind
   * each other, same as `claim`. Deleting a row frees its `dedupe_key`; every
   * keyed producer today keys on an id that only ever transitions once
   * (an attempt's creation, a provider event's receipt, a transaction's one
   * `succeeded` flip), so a freed key is never re-enqueued in practice.
   */
  async purgePublished(olderThanDays: number, limit: number): Promise<number> {
    const rows = await this.db
      .delete(outboxEvents)
      .where(
        sql`${outboxEvents.id} in (
          select ${outboxEvents.id} from ${outboxEvents}
          where ${outboxEvents.status} = 'published'
            and ${outboxEvents.publishedAt} < now() - make_interval(days => ${olderThanDays})
          order by ${outboxEvents.publishedAt}
          for update skip locked
          limit ${limit}
        )`,
      )
      .returning({ id: outboxEvents.id });
    return rows.length;
  }

  private claim(where: SQL, limit: number): Promise<OutboxEventRow[]> {
    return this.db
      .update(outboxEvents)
      .set({
        status: 'processing',
        // Counted at claim time, not on completion, so a dispatcher that
        // dies mid-send still burns an attempt. Otherwise an event that
        // reliably crashes its handler would be retried forever.
        attempts: sql`${outboxEvents.attempts} + 1`,
        lockedAt: sql`now()`,
        lockedBy: this.instanceId,
      })
      .where(
        sql`${outboxEvents.id} in (
          select ${outboxEvents.id} from ${outboxEvents}
          where ${where}
          order by ${outboxEvents.availableAt}
          for update skip locked
          limit ${limit}
        )`,
      )
      .returning();
  }

  /**
   * Due = waiting and off backoff, or holding a lease that has gone stale.
   * The second half is crash recovery: a dispatcher that died between
   * claiming and finishing left a row in `processing` that nothing else
   * would ever look at again.
   */
  private dueCondition(): SQL {
    const leaseSeconds =
      this.configService.get<number>('outbox.leaseTimeoutSeconds') ?? 60;

    return sql`(
      (${outboxEvents.status} = 'pending' and ${outboxEvents.availableAt} <= now())
      or (
        ${outboxEvents.status} = 'processing'
        and ${outboxEvents.lockedAt} < now() - make_interval(secs => ${leaseSeconds})
      )
    )`;
  }
}
