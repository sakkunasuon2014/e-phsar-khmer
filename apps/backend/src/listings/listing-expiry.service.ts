import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { DRIZZLE, type DbClient } from '../db/drizzle.provider';
import { listings, notifications, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import type { NotificationPayload } from '../notifications/notification-channel.interface';
import {
  DAY_MS,
  EXPIRED_LOOKBACK_MS,
  EXPIRING_WINDOW_MS,
} from './listing-expiry.constants';

type ExpiryCandidate = {
  id: string;
  userId: string;
  title: string;
  expiresAt: Date;
};

/** `notifications.title` is varchar(200); a seller's title can be longer. */
const NOTICE_TITLE_MAX = 120;

function quotedTitle(title: string): string {
  const trimmed = title.trim();
  const clipped =
    trimmed.length > NOTICE_TITLE_MAX
      ? `${trimmed.slice(0, NOTICE_TITLE_MAX - 1)}…`
      : trimmed;
  return `"${clipped}"`;
}

/**
 * Tells owners their ad is about to lapse and, once, that it has lapsed.
 *
 * The ad itself never changes status when `expires_at` passes — expiry is
 * derived at read time (see `ListingsService.liveConditions`) — so this
 * sweep is the only thing that tells the owner why their ad left the feed.
 * Each notice is deduped by (listingId, expiresAt): a renewal resets the
 * date, so the next window earns a fresh warning.
 */
@Injectable()
export class ListingExpiryService {
  private readonly logger = new Logger(ListingExpiryService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(
    now: Date = new Date(),
  ): Promise<{ expiring: number; expired: number }> {
    const expiring = await this.notifyExpiring(now);
    const expired = await this.notifyExpired(now);
    return { expiring, expired };
  }

  /** Ads inside the warning window: `now < expires_at <= now + 3 days`. */
  private async notifyExpiring(now: Date): Promise<number> {
    const until = new Date(now.getTime() + EXPIRING_WINDOW_MS);
    const rows = await this.db
      .select({
        id: listings.id,
        userId: listings.userId,
        title: listings.title,
        expiresAt: listings.expiresAt,
      })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.userId))
      .where(
        and(
          eq(listings.status, 'active'),
          isNotNull(listings.expiresAt),
          gt(listings.expiresAt, now),
          lte(listings.expiresAt, until),
          isNull(users.deletedAt),
        ),
      );

    const pending = await this.unnotified('listing.expiring', rows);
    let sent = 0;
    for (const row of pending) {
      const days = Math.max(
        1,
        Math.ceil((row.expiresAt.getTime() - now.getTime()) / DAY_MS),
      );
      const delivered = await this.send({
        userId: row.userId,
        type: 'listing.expiring',
        title: `Your ad ${quotedTitle(row.title)} expires in ${days} day${days === 1 ? '' : 's'}`,
        body: 'Renew it from Manage Ads to keep it live in the marketplace.',
        data: {
          listingId: row.id,
          expiresAt: row.expiresAt.toISOString(),
          days,
        },
      });
      if (delivered) sent++;
    }
    return sent;
  }

  /** Ads that lapsed in the last 24 h — the grace window for the notice. */
  private async notifyExpired(now: Date): Promise<number> {
    const since = new Date(now.getTime() - EXPIRED_LOOKBACK_MS);
    const rows = await this.db
      .select({
        id: listings.id,
        userId: listings.userId,
        title: listings.title,
        expiresAt: listings.expiresAt,
      })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.userId))
      .where(
        and(
          eq(listings.status, 'active'),
          isNotNull(listings.expiresAt),
          lte(listings.expiresAt, now),
          gt(listings.expiresAt, since),
          isNull(users.deletedAt),
        ),
      );

    const pending = await this.unnotified('listing.expired', rows);
    let sent = 0;
    for (const row of pending) {
      const delivered = await this.send({
        userId: row.userId,
        type: 'listing.expired',
        title: `Your ad ${quotedTitle(row.title)} has expired`,
        body: 'Renew it from Manage Ads to put it back on the marketplace.',
        data: { listingId: row.id, expiresAt: row.expiresAt.toISOString() },
      });
      if (delivered) sent++;
    }
    return sent;
  }

  /**
   * Drops candidates whose (listingId, expiresAt) already produced a notice
   * of this type. The key lives in `data`, so no extra column or migration.
   */
  private async unnotified(
    type: string,
    rows: {
      id: string;
      userId: string;
      title: string;
      expiresAt: Date | null;
    }[],
  ): Promise<ExpiryCandidate[]> {
    const candidates = rows.filter(
      (row): row is ExpiryCandidate => row.expiresAt !== null,
    );
    if (candidates.length === 0) return [];

    const userIds = [...new Set(candidates.map((row) => row.userId))];
    const existing = await this.db
      .select({ data: notifications.data })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, type),
          inArray(notifications.userId, userIds),
        ),
      );
    const seen = new Set(
      existing.map((row) => {
        const data = row.data;
        return `${String(data.listingId)}:${String(data.expiresAt)}`;
      }),
    );
    return candidates.filter(
      (row) => !seen.has(`${row.id}:${row.expiresAt.toISOString()}`),
    );
  }

  /** One failed notice must not abort the sweep — the next run retries it. */
  private async send(payload: NotificationPayload): Promise<boolean> {
    try {
      await this.notifications.notify(payload);
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not notify ${payload.userId} (${payload.type}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
