/**
 * Failure codes that mean "we gave up waiting", not "the provider said no".
 * An attempt failed this way may still have been paid — Bakong has no webhook
 * and its poll chain can die — so the reconciler keeps asking about it for a
 * grace window and settles it if the money turns out to have arrived.
 *
 * Deliberately excludes `CHARGE_GATEWAY_ERROR` (no QR/charge ever existed, so
 * there is nothing a payer could have paid) and `PROVIDER_NOT_REGISTERED` /
 * `GATEWAY_NOT_CONFIGURED` (config problems the reconciler cannot resolve).
 */
export const RECOVERABLE_FAILURE_CODES = [
  'POLL_EXPIRED',
  'POLL_GATEWAY_ERROR',
] as const;

export interface ReconcilableAttempt {
  status: 'pending' | 'succeeded' | 'failed';
  failureCode: string | null;
}

/** Whether asking the provider about this attempt can still change anything. */
export function isReconcilable(attempt: ReconcilableAttempt): boolean {
  if (attempt.status === 'pending') return true;
  return (
    attempt.status === 'failed' &&
    (RECOVERABLE_FAILURE_CODES as readonly string[]).includes(
      attempt.failureCode ?? '',
    )
  );
}

export interface AbandonCheck {
  createdAt: Date;
  /** The checkout's own deadline (`payment_transactions.expires_at`), if one was recorded. */
  expiresAt: Date | null;
  now: number;
  /** Slack past `expiresAt`, so a payer at the deadline still settles. */
  graceMs: number;
  /** Backstop on age, for a checkout with no recorded expiry. */
  abandonAfterMs: number;
}

/**
 * Whether a still-unpaid `pending` attempt should stop being polled as a live
 * checkout. The provider has already been asked and said "not paid" by the
 * time this is judged, so it never fails a paid attempt on the clock.
 *
 * Ends at the checkout's own expiry rather than a flat age: a KHQR lives five
 * minutes, and polling it for fifteen would triple the provider calls spent on
 * every abandoned checkout.
 */
export function isPendingAbandoned(check: AbandonCheck): boolean {
  if (check.now - check.createdAt.getTime() >= check.abandonAfterMs) {
    return true;
  }
  return (
    check.expiresAt !== null &&
    check.now >= check.expiresAt.getTime() + check.graceMs
  );
}

export interface TickState {
  /** Still-`pending` attempts in view this pass. */
  pending: number;
  /** Age of the newest one; `null` when none are pending. */
  newestPendingAgeMs: number | null;
  /** The pass settled, activated, abandoned or errored on something. */
  didWork: boolean;
}

export interface TickDelayOptions {
  /** Interval while a payer has only just been issued a checkout. */
  fastIntervalMs: number;
  /** How long after issue the fast interval applies. */
  fastWindowMs: number;
  /** Interval while any checkout is still pending. */
  baseIntervalMs: number;
  /** Safety-sweep interval with nothing pending. */
  idleIntervalMs: number;
}

/**
 * How long to sleep before the next reconcile pass.
 *
 * Demand-driven: the tight interval exists only while a payer is likely still
 * scanning; with nothing pending the loop falls back to a slow safety sweep
 * (which also covers a checkout issued on another instance). Issuing a payment
 * re-arms it at once via `PaymentReconciler.arm()`.
 */
export function nextTickDelayMs(
  state: TickState,
  options: TickDelayOptions,
): number {
  if (state.pending > 0) {
    const age = state.newestPendingAgeMs ?? Number.POSITIVE_INFINITY;
    return age < options.fastWindowMs
      ? options.fastIntervalMs
      : options.baseIntervalMs;
  }
  if (state.didWork) return options.baseIntervalMs;
  return Math.max(options.idleIntervalMs, options.baseIntervalMs);
}
