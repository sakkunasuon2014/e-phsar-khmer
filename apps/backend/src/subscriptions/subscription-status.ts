import type { SupersededReason } from '../db/schema/subscriptions.schema';

export type { SupersededReason };

export type SubscriptionStatus =
  | 'active'
  | 'expired'
  | 'superseded'
  | 'revoked';

export function subscriptionStatus(
  row: {
    expiresAt: Date;
    supersededAt: Date | null;
    supersededReason: SupersededReason | null;
  },
  now = Date.now(),
): SubscriptionStatus {
  if (row.supersededAt) {
    if (row.supersededReason === 'revoked') return 'revoked';
    if (row.supersededReason === 'expired') return 'expired';
    return 'superseded';
  }
  return row.expiresAt.getTime() > now ? 'active' : 'expired';
}
