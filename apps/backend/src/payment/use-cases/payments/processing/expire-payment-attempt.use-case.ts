import { Effect } from 'effect';
import { DbClientTag, runInTransaction } from '../../../../db/db.provider';
import { PaymentPersistenceError } from '../errors';
import type { PaymentProcessingError } from '../errors';
import { findPaymentAttempt } from '../attempt/find-payment-attempt.use-case';
import { checkPayment } from '../transaction/check-payment.use-case';
import { failPaymentAttempt } from './fail-payment-attempt.use-case';

export type ExpirePaymentAttemptOutcome = 'skipped' | 'expired';

/**
 * Fails a still-pending attempt whose checkout has expired. No provider call:
 * for a webhook-only provider the provider itself refuses payment after its
 * lifetime, so there is nothing left to ask. Safe against a racing webhook —
 * `failPaymentAttempt` is version-guarded, so whichever commits second loses.
 */
export const expirePaymentAttempt = Effect.fn('expirePaymentAttempt')(
  function* (input: {
    paymentAttemptId: string;
  }): Effect.fn.Return<
    ExpirePaymentAttemptOutcome,
    PaymentProcessingError,
    DbClientTag
  > {
    const attempt = yield* findPaymentAttempt(input.paymentAttemptId);
    if (attempt.status !== 'pending') return 'skipped';

    const transaction = yield* checkPayment(attempt.paymentTransactionId);
    if (
      transaction.status !== 'pending' &&
      transaction.status !== 'processing'
    ) {
      return 'skipped';
    }

    yield* runInTransaction(
      failPaymentAttempt({
        attempt,
        transaction,
        failureCode: 'EXPIRED',
        failureMessage: 'The checkout expired before payment was confirmed',
      }),
      (cause) => new PaymentPersistenceError({ cause }),
    );
    return 'expired';
  },
);
