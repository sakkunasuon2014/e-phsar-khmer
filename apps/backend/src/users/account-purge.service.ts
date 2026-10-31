import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { users } from '../db/schema/users.schema';
import { FilesService } from '../files/files.service';

/**
 * How long a self-deleted account stays recoverable, and therefore how long
 * it lives before this service removes it. Shared with AuthService's
 * reactivation window — if the two drifted, someone could sign back into an
 * account the sweeper had already emptied.
 */
export const ACCOUNT_RETENTION_DAYS = 90;

/** Rows claimed per transaction, so a first sweep over a large table stays bounded. */
const PURGE_BATCH_SIZE = 200;

/** Falls back to 6 h — the window is 90 days, so precision is irrelevant. */
const DEFAULT_INTERVAL_MS = 21_600_000;

/** The first sweep waits this long (plus up to a minute of jitter) after boot. */
const FIRST_SWEEP_MIN_DELAY_MS = 60_000;

/**
 * Hard-deletes accounts whose 90-day recovery window has closed.
 *
 * The trigger is a *predicate* (`deleted_at` older than the window), not a
 * per-row due date, so running late is harmless and running twice is a no-op —
 * which is why this is a plain sweeper rather than a queued job: it needs no
 * Redis to stay alive, and an instance that was down simply catches up on the
 * next tick (and once at boot).
 *
 * Every FK into `users` is ON DELETE CASCADE, so the listings, chats,
 * notifications, reports, subscriptions and key material go with the row in
 * the same statement; only the storage objects need handling afterwards.
 */
@Injectable()
export class AccountPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountPurgeService.name);
  private timer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly configService: ConfigService,
    private readonly filesService: FilesService,
  ) {}

  onModuleInit(): void {
    // `test:e2e` boots the whole AppModule; an armed interval would outlive
    // app.close() and keep Jest hanging. The service is still a plain class
    // there, so purgeDueAccounts() stays directly testable.
    if (process.env.NODE_ENV === 'test') return;
    if (!(this.configService.get<boolean>('accounts.purgeEnabled') ?? true)) {
      return;
    }

    const intervalMs =
      this.configService.get<number>('accounts.purgeIntervalMs') ??
      DEFAULT_INTERVAL_MS;

    // Not at boot: a service that restarts often (or scales out) would turn
    // every start into a purge query. The recovery window is 90 days, so the
    // first sweep can wait a jittered 1-2 minutes.
    this.bootTimer = setTimeout(
      () => void this.sweep(),
      FIRST_SWEEP_MIN_DELAY_MS + Math.random() * 60_000,
    );
    this.bootTimer.unref?.();
    this.timer = setInterval(() => void this.sweep(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Removes every account past the retention window, in batches. Returns how
   * many were deleted — the number a test or a manual run cares about.
   */
  async purgeDueAccounts(): Promise<number> {
    let removed = 0;

    for (;;) {
      const batch = await this.purgeBatch();
      removed += batch.length;

      // Storage cleanup happens outside the transaction — the rows are
      // already gone, and removeByPublicUrl warns rather than throws.
      for (const row of batch) {
        if (row.profilePhotoUrl) {
          await this.filesService.removeByPublicUrl(row.profilePhotoUrl);
        }
        if (row.coverPhotoUrl) {
          await this.filesService.removeByPublicUrl(row.coverPhotoUrl);
        }
      }

      if (batch.length < PURGE_BATCH_SIZE) return removed;
    }
  }

  /**
   * One transaction per batch. `FOR UPDATE SKIP LOCKED` is what keeps two
   * instances (or two ticks) from claiming the same rows — each takes a
   * disjoint set, and neither blocks on the other.
   */
  private async purgeBatch(): Promise<
    {
      id: string;
      profilePhotoUrl: string | null;
      coverPhotoUrl: string | null;
    }[]
  > {
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select({
          id: users.id,
          profilePhotoUrl: users.profilePhotoUrl,
          coverPhotoUrl: users.coverPhotoUrl,
        })
        .from(users)
        .where(
          and(
            isNotNull(users.deletedAt),
            // `now()` is the database's clock, not this process's — the same
            // reason the outbox computes due-times server-side.
            lt(
              users.deletedAt,
              sql`now() - make_interval(days => ${ACCOUNT_RETENTION_DAYS})`,
            ),
          ),
        )
        .orderBy(users.deletedAt)
        .limit(PURGE_BATCH_SIZE)
        .for('update', { skipLocked: true });

      if (due.length === 0) return [];

      await tx.delete(users).where(
        inArray(
          users.id,
          due.map((row) => row.id),
        ),
      );

      return due;
    });
  }

  private async sweep(): Promise<void> {
    try {
      const removed = await this.purgeDueAccounts();
      if (removed > 0) {
        this.logger.log(
          `Purged ${removed} account(s) past the ${ACCOUNT_RETENTION_DAYS}-day window`,
        );
      }
    } catch (err) {
      // A failed sweep must never take the process down — the next tick
      // retries the same predicate.
      this.logger.error(
        'Account purge sweep failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
