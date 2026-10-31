import {
  and,
  eq,
  gt,
  isNull,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import type { DbClient } from '../db/drizzle.provider';
import { userSubscriptions } from '../db/schema/subscriptions.schema';

/**
 * True while the user holds at least one current, unexpired paid plan.
 *
 * Paid verification is derived, never stored: an active row is the only
 * source of truth, so an expiry or a revoke removes `verifiedAccount` from
 * the next read with no sweep to miss. The partial index
 * `user_subscriptions_active_idx (user_id, expires_at) WHERE superseded_at
 * IS NULL` serves this lookup.
 */
export async function hasActivePaidSubscription(
  db: DbClient,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: userSubscriptions.id })
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.userId, userId),
        isNull(userSubscriptions.supersededAt),
        gt(userSubscriptions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The same predicate as a correlated subquery, for row selects that need a
 * seller's verification without an extra round trip. `userId` is the column
 * expression to correlate on (e.g. `listings.userId`).
 */
export function activePaidSubscriptionExistsSql(
  userId: SQLWrapper,
): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from user_subscriptions us
    where us.user_id = ${userId}
      and us.superseded_at is null
      and us.expires_at > now()
  )`;
}
