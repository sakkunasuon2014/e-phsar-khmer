import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxService } from './outbox.service';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** The first sweep waits this long (plus up to a minute of jitter) after boot. */
const FIRST_SWEEP_MIN_DELAY_MS = 60_000;
const SWEEP_BATCH_SIZE = 1000;
/** Caps one sweep's work so a huge first backlog can't hog the pool; the next hour continues. */
const MAX_BATCHES_PER_SWEEP = 50;

/**
 * Purges `published` outbox rows older than `OUTBOX_RETENTION_DAYS`
 * (default 7; `0` or less disables it). Without this the table only grows —
 * the Bakong poll loop alone writes one row per round per pending attempt.
 *
 * Runs hourly on every instance that runs the worker pool (same
 * `OUTBOX_WORKER_ENABLED` switch — an API-only instance leaves housekeeping
 * to the drainers). Concurrent sweeps are safe: `purgePublished` skips rows
 * another instance is already deleting. Kept separate from `OutboxWorker`
 * on purpose: dispatch and retention change for different reasons.
 */
@Injectable()
export class OutboxRetention
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxRetention.name);
  private readonly retentionDays: number;
  private bootTimer: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout | undefined;
  private sweeping = false;

  constructor(
    private readonly outbox: OutboxService,
    private readonly configService: ConfigService,
  ) {
    this.retentionDays =
      this.configService.get<number>('outbox.retentionDays') ?? 7;
  }

  onApplicationBootstrap(): void {
    if (this.configService.get<boolean>('outbox.workerEnabled') === false) {
      return;
    }
    if (this.retentionDays <= 0) {
      this.logger.log('Outbox retention disabled (OUTBOX_RETENTION_DAYS <= 0)');
      return;
    }

    // Not at boot: an instance that restarts often (or scales out) would turn
    // every start into a delete query. Retention is housekeeping with a
    // days-long horizon, so the first sweep waits a jittered 1-2 minutes.
    const firstSweepMs = FIRST_SWEEP_MIN_DELAY_MS + Math.random() * 60_000;
    this.bootTimer = setTimeout(() => {
      void this.sweep();
      this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
      this.timer.unref();
    }, firstSweepMs);
    this.bootTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /** One sweep: deletes in batches until a batch comes back short. Never throws. */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let total = 0;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_SWEEP; i++) {
        const deleted = await this.outbox.purgePublished(
          this.retentionDays,
          SWEEP_BATCH_SIZE,
        );
        total += deleted;
        if (deleted < SWEEP_BATCH_SIZE) break;
      }
      if (total > 0) {
        this.logger.log(
          `Purged ${total} published outbox row(s) older than ${this.retentionDays}d`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Outbox retention sweep failed: ${message}`);
    } finally {
      this.sweeping = false;
    }
    return total;
  }
}
