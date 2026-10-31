import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { listingEvents } from '../db/schema/insights.schema';
import type { ListingEventType } from '../db/schema/insights.schema';

/**
 * Trend ranking weights.
 *
 * A buyer action that costs effort (a chat, a call, a job application)
 * outranks a passive view. Impressions are deliberately absent: the web fires
 * them on half-visible cards, so they measure placement, not demand.
 */
export const TRENDING_EVENT_WEIGHTS: ReadonlyArray<{
  type: ListingEventType;
  weight: number;
}> = [
  { type: 'view', weight: 1 },
  { type: 'chat', weight: 3 },
  { type: 'call', weight: 3 },
  { type: 'show_contact', weight: 3 },
  { type: 'apply_job', weight: 5 },
];

/** Likes and saves are cheap-but-deliberate; owner self-likes are excluded. */
export const TRENDING_LIKE_WEIGHT = 2;
export const TRENDING_SAVE_WEIGHT = 2;

export const TRENDING_WINDOW_DAYS = 7;
export const TRENDING_WINDOW_DAYS_MAX = 30;
export const TRENDING_LIMIT = 10;
export const TRENDING_LIMIT_MAX = 20;

/** How long a computed trend list is reused (per process) before re-ranking. */
export const TRENDING_CACHE_MS = 5 * 60 * 1000;

/**
 * The weighted `listing_events` score for one listing, as SQL.
 *
 * Kept pure and column-scoped so unit tests can compile it and assert on the
 * weights instead of trusting a query built inline in the service.
 */
export function trendingEventScoreSql(): SQL<number> {
  const parts = TRENDING_EVENT_WEIGHTS.map(
    ({ type, weight }) =>
      sql`count(*) filter (where ${listingEvents.eventType} = ${type}) * ${weight}`,
  );
  return sql<number>`(${sql.join(parts, sql` + `)})::int`;
}
