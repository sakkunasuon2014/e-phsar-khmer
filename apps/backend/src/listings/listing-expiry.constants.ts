/** How long before `expires_at` the owner is warned. */
export const EXPIRING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Only ads that lapsed within this window get the "expired" notice. Without
 * it, the first sweep after a deploy would notify the owner of every ad that
 * ever expired.
 */
export const EXPIRED_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** The hourly sweep: warns at T-3 days and once after the lapse. */
export const LISTING_EXPIRY_QUEUE = 'listing-expiry';
export const LISTING_EXPIRY_SWEEP_JOB = 'listing-expiry-sweep';
export const LISTING_EXPIRY_SWEEP_EVERY_MS = 60 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;
