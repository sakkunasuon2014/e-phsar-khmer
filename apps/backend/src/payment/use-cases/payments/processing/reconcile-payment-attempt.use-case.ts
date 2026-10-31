import { Effect } from 'effect';
import { DbClientTag, runInTransaction } from '../../../../db/db.provider';
import type { OutboxService } from '../../../../outbox/outbox.service';
import { PaymentGatewayRegistryTag } from '../../../providers/payment-gateway-registry.provider';
import {
  isPendingAbandoned,
  isReconcilable,
} from '../../../reconciler/reconcile-policy';
import { PaymentGatewayCallError, PaymentPersistenceError } from '../errors';
import type { PaymentProcessingError } from '../errors';
import { findPaymentAttempt } from '../attempt/find-payment-attempt.use-case';
import { checkPayment } from '../transaction/check-payment.use-case';
import { failPaymentAttempt } from './fail-payment-attempt.use-case';
import { settleReconciledAttempt } from './settle-reconciled-attempt.use-case';

export type ReconcilePaymentAttemptOutcome =
  | 'skipped'
  | 'no_reconcile'
  | 'gateway_not_registered'
  | 'gateway_not_configured'
  | 'still_pending'
  | 'abandoned'
  | 'succeeded'
  | 'failed';

export interface ReconcilePaymentAttemptInput {
  paymentAttemptId: string;
  /**
   * Age backstop: a `pending` attempt older than this that the provider still
   * reports unpaid is failed `POLL_EXPIRED`, for a checkout that recorded no
   * expiry of its own. It stays in the reconciler's late-payment window
   * afterwards, so a payment that lands later still settles.
   */
  abandonPendingAfterMs: number;
  /**
   * Slack past the checkout's own expiry (`payment_transactions.expires_at`)
   * before an unpaid attempt is failed. The normal end of a polled checkout:
   * a KHQR lives five minutes, so it is not polled for the whole backstop.
   */
  expiryGraceMs: number;
}

/**
 * One server-side "ask the provider and settle if paid" — independent of any
 * BullMQ chain, outbox row or browser. This is what makes a payment that was
 * made while the app was down (or while the poll chain was broken) settle
 * anyway: the background reconciler calls it for every unresolved attempt.
 *
 * Order matters: the provider is asked FIRST and expiry is judged only on an
 * unpaid answer, so a paid-but-late attempt is never failed on the clock.
 * A gateway error throws (never fails the attempt), so a Bakong outage
 * cannot turn a paid attempt into a failed one.
 */
export const reconcilePaymentAttempt = Effect.fn('reconcilePaymentAttempt')(
  function* (
    outbox: OutboxService,
    input: ReconcilePaymentAttemptInput,
  ): Effect.fn.Return<
    ReconcilePaymentAttemptOutcome,
    PaymentProcessingError,
    DbClientTag | PaymentGatewayRegistryTag
  > {
    const attempt = yield* findPaymentAttempt(input.paymentAttemptId);
    if (!isReconcilable(attempt)) {
      return 'skipped';
    }

    const registry = yield* PaymentGatewayRegistryTag;
    let provider: ReturnType<typeof registry.resolve> | undefined;
    try {
      provider = registry.resolve(attempt.provider);
    } catch {
      provider = undefined;
    }
    if (!provider) return 'gateway_not_registered';
    if (provider.isConfigured && !provider.isConfigured()) {
      return 'gateway_not_configured';
    }
    if (!provider.reconcile || !attempt.providerAttemptId) {
      return 'no_reconcile';
    }

    const transaction = yield* checkPayment(attempt.paymentTransactionId);
    if (transaction.status === 'succeeded') {
      return 'skipped';
    }

    // Outside any DB transaction — an HTTP call shouldn't hold locks open.
    const result = yield* Effect.tryPromise({
      try: () => provider.reconcile!(attempt.providerAttemptId!),
      catch: (cause) => new PaymentGatewayCallError({ cause }),
    });

    if (result.status === 'pending') {
      if (
        attempt.status === 'pending' &&
        isPendingAbandoned({
          createdAt: attempt.createdAt,
          expiresAt: transaction.expiresAt,
          now: Date.now(),
          graceMs: input.expiryGraceMs,
          abandonAfterMs: input.abandonPendingAfterMs,
        })
      ) {
        yield* runInTransaction(
          failPaymentAttempt({
            attempt,
            transaction,
            failureCode: 'POLL_EXPIRED',
            failureMessage:
              'No payment confirmation arrived before the checkout expired',
          }),
          (cause) => new PaymentPersistenceError({ cause }),
        );
        return 'abandoned';
      }
      return 'still_pending';
    }

    // A failed attempt only ever moves forward to success — a provider
    // "failed" answer for something we already failed changes nothing.
    if (attempt.status === 'failed' && result.status === 'failed') {
      return 'skipped';
    }

    return yield* settleReconciledAttempt(outbox, {
      attempt,
      transaction,
      provider,
      result: { ...result, status: result.status },
      reason: attempt.status === 'failed' ? 'late_payment' : 'reconcile',
    });
  },
);
