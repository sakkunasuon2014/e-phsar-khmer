import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';
import { WakeupSignal } from './wakeup-signal';

const SHUTDOWN_GRACE_MS = 10_000;
/** Never re-check sooner than this, so a row due "in a few ms" cannot spin the timer. */
const MIN_CHECK_DELAY_MS = 100;
/** Slack added to a computed due-time so the row is claimable when the check fires. */
const DUE_SLACK_MS = 50;
/** How often the stats summary line is written (piggybacks on a check; no timer of its own). */
const STATS_REPORT_EVERY_MS = 10 * 60_000;

/**
 * The background worker: Postgres is the queue, this is the consumer pool.
 *
 * It runs in-process on every API instance. That is safe because claiming
 * is atomic (`FOR UPDATE SKIP LOCKED`), so N instances simply drain the
 * table N times faster — no leader election, no broker. Set
 * `OUTBOX_WORKER_ENABLED=false` to disable this drainer when another
 * deployment is responsible for draining the table.
 *
 * The trigger is event-driven (a producer's `wakeupAfterCommit`), backed by
 * a check timer that is independent of the workers. The timer does not poll
 * on a fixed beat: each check asks the database when the earliest row becomes
 * due (`OutboxService.msUntilNextDue`) and sleeps until then, capped at
 * `OUTBOX_POLL_INTERVAL_MS`. So an idle instance costs one cheap query per
 * heartbeat — the safety net for a lost wakeup or a producer in another
 * process — and a backoff retry still fires on time because every drain that
 * handled events re-arms the timer from the database. The pool stays bounded:
 * fixed worker count, coalesced wakeup signal, capped batch — memory is
 * O(workers + batch); the durable backlog lives in `outbox_events`, never in
 * RAM.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly wakeupSignal = new WakeupSignal();
  private readonly workers: Promise<void>[] = [];
  private running = false;
  private checkTimer: NodeJS.Timeout | undefined;
  private checking = false;
  private checkAgain = false;
  /** Set when a check finds due rows, taken by the first worker that wakes. */
  private fallbackDue = false;
  private stats = { checks: 0, drains: 0, events: 0 };
  private statsSince = Date.now();

  private readonly concurrency: number;
  /** Longest the timer ever sleeps: the lost-wakeup / cross-process heartbeat. */
  private readonly heartbeatMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly outbox: OutboxService,
    private readonly configService: ConfigService,
  ) {
    this.concurrency =
      this.configService.get<number>('outbox.workerConcurrency') ?? 5;
    this.heartbeatMs =
      this.configService.get<number>('outbox.pollIntervalMs') ?? 30_000;
    this.batchSize = this.configService.get<number>('outbox.batchSize') ?? 10;
  }

  onApplicationBootstrap(): void {
    if (this.configService.get<boolean>('outbox.workerEnabled') === false) {
      this.logger.log('Outbox worker disabled by configuration');
      return;
    }

    this.running = true;
    this.logger.log(
      `Outbox worker started as ${this.outbox.instanceId} ` +
        `(concurrency ${this.concurrency}, heartbeat ${this.heartbeatMs}ms, ` +
        `batch ${this.batchSize})`,
    );

    for (let i = 0; i < this.concurrency; i++) {
      const workerId = `${this.outbox.instanceId}:${i}`;
      this.workers.push(
        this.worker(workerId).catch((error: unknown) => {
          this.logger.error(
            `[OutboxWorker:${workerId}] stopped unexpectedly`,
            error instanceof Error ? error.stack : String(error),
          );
        }),
      );
    }

    // The check timer lives outside the workers on purpose: if it belonged to
    // one of them, a handler that hangs that worker would stop the heartbeat
    // for the whole instance. The first check doubles as the startup drain: a
    // backlog committed before this process booted shows up as "due now" and
    // wakes the pool, while an empty table costs a single peek (not a claim
    // per worker).
    void this.check();
  }

  async onModuleDestroy(): Promise<void> {
    // Stop accepting work: workers finish the batch they are on, then exit.
    this.running = false;
    if (this.checkTimer) clearTimeout(this.checkTimer);

    // Releasing blocked readers is what lets the worker loops observe
    // `running === false` and unwind.
    this.wakeupSignal.close();

    // Let in-flight dispatches settle, but never block shutdown forever on a
    // handler that hangs — an abandoned row is recovered by the stale-lease
    // claim predicate.
    await Promise.race([
      Promise.allSettled(this.workers),
      new Promise<void>((resolve) =>
        setTimeout(resolve, SHUTDOWN_GRACE_MS).unref(),
      ),
    ]);
  }

  /**
   * Called by the wakeup listener once a producer's transaction commits.
   *
   * This does NOT perform the dispatch — it tells the local pool to check
   * PostgreSQL. Notifications coalesce while workers are busy.
   */
  wakeup(): void {
    this.wakeupSignal.notify();
  }

  /**
   * One drain. Exposed for tests and for anything that wants to drain the
   * outbox on demand; the loop is just this behind the wakeup channel.
   */
  async runOnce(): Promise<number> {
    const outcomes = await this.dispatcher.dispatchDue(this.batchSize);

    const failed = outcomes.filter((o) => o.status === 'failed');
    if (failed.length) {
      this.logger.warn(
        `${failed.length} outbox event(s) failed: ${failed
          .map((o) => `${o.eventType}#${o.eventId}`)
          .join(', ')}`,
      );
    }

    return outcomes.length;
  }

  private async worker(workerId: string): Promise<void> {
    while (this.running) {
      const result = await this.wakeupSignal.wait();
      if (result !== 'signaled' || !this.running) break;

      // Take the fallback flag: whichever worker wakes first after a tick is
      // the one that reports a discovered backlog to its peers.
      const fallbackPoll = this.fallbackDue;
      this.fallbackDue = false;

      await this.drain(workerId, fallbackPoll);
    }
  }

  /**
   * Drains the backlog. Loops immediately while batches come back full (there
   * is probably more waiting), and returns to the wakeup wait once a batch is
   * not full.
   */
  private async drain(workerId: string, fallbackPoll: boolean): Promise<void> {
    this.stats.drains += 1;
    let handledAny = false;
    try {
      while (this.running) {
        let processed = 0;
        try {
          processed = await this.runOnce();
        } catch (error) {
          // Includes losing the database. Log and return to the wait — the
          // next wakeup or heartbeat retries, and rows stay claimable either
          // way.
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `[OutboxWorker:${workerId}] drain failed: ${message}`,
          );
          return;
        }

        this.stats.events += processed;
        if (processed > 0) handledAny = true;

        // A check can discover a backlog even when producers live in a
        // different process. Wake parked peers to restore configured claim
        // concurrency; this worker is busy, so it cannot wake itself.
        if (fallbackPoll && processed > 0) {
          this.wakeupSignal.notifyWaiters();
          fallbackPoll = false;
        }

        if (processed < this.batchSize) {
          return;
        }
      }
    } finally {
      // Handling events is what creates future due-times (a retry's backoff):
      // re-arm from the database so that retry is not left to the heartbeat.
      if (handledAny) void this.check();
    }
  }

  /** Counters for the current reporting window. */
  getStats(): { checks: number; drains: number; events: number } {
    return { ...this.stats };
  }

  /**
   * Asks the database when work is next due, wakes the pool if it is due now,
   * and re-arms the timer. Never throws, never overlaps itself: a request that
   * arrives mid-check makes the running check go once more, so a retry
   * committed after its query started is still seen.
   */
  private async check(): Promise<void> {
    if (this.checking) {
      this.checkAgain = true;
      return;
    }
    this.checking = true;
    try {
      do {
        this.checkAgain = false;
        await this.checkOnce();
      } while (this.checkAgain && this.running);
    } finally {
      this.checking = false;
    }
  }

  private async checkOnce(): Promise<void> {
    if (!this.running) return;

    let nextDelay = this.heartbeatMs;
    try {
      this.stats.checks += 1;
      const msUntilDue = await this.outbox.msUntilNextDue();
      if (msUntilDue !== null) {
        if (msUntilDue <= 0) {
          // Due now: one worker claims, and fans out to its peers if the
          // backlog turns out to be bigger than one batch.
          this.fallbackDue = true;
          this.wakeupSignal.notifyOne();
        } else {
          nextDelay = Math.min(
            this.heartbeatMs,
            Math.max(MIN_CHECK_DELAY_MS, msUntilDue + DUE_SLACK_MS),
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Outbox due-time check failed: ${message}`);
      // Don't trust a failed peek to mean "nothing due": try a plain claim, as
      // the pre-peek heartbeat did, so a broken peek can never strand rows.
      this.fallbackDue = true;
      this.wakeupSignal.notifyOne();
    }

    this.reportStatsIfDue();

    if (!this.running) return;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.check(), nextDelay);
    this.checkTimer.unref();
  }

  private reportStatsIfDue(): void {
    const now = Date.now();
    if (now - this.statsSince < STATS_REPORT_EVERY_MS) return;

    const minutes = Math.round((now - this.statsSince) / 60_000);
    this.logger.log(
      `Outbox stats (last ${minutes}m): ${this.stats.checks} due-time checks, ` +
        `${this.stats.drains} drains, ${this.stats.events} events handled`,
    );
    this.stats = { checks: 0, drains: 0, events: 0 };
    this.statsSince = now;
  }
}
