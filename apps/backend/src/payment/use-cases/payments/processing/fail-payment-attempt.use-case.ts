import { Effect } from 'effect';
import { DbClientTag } from '../../../../db/db.provider';
import type { PaymentAttemptRow, PaymentTransactionRow } from '../../../entity';
import {
  PaymentPersistenceError,
  PaymentTransactionConflictError,
  PaymentTransactionNotFoundError,
} from '../errors';
import { updatePaymentAttempt } from '../attempt/update-payment-attempt.use-case';
import { upsertPayment } from '../transaction/upsert-payment.use-case';
import { recordPaymentStatusHistory } from '../transaction/record-payment-status-history.use-case';

export interface FailPaymentAttemptInput {
  attempt: Pick<PaymentAttemptRow, 'id'>;
  transaction: Pick<PaymentTransactionRow, 'id' | 'version' | 'status'>;
  failureCode: string;
  failureMessage: string;
}

// The NotFound/Conflict members come from upsertPayment's own error union —
// every caller here already has PaymentProcessingError as its declared
// return type, which covers both.
type FailPaymentAttemptError =
  | PaymentTransactionNotFoundError
  | PaymentTransactionConflictError
  | PaymentPersistenceError;

/**
 * Marks a `payment_attempt` and its `payment_transaction` `failed` together,
 * with a status-history entry. The one shared shape behind every "give up
 * on this attempt outright" branch in the processing use-cases —
 * unregistered provider (`processPaymentAttempt`), checkout expiry
 * (`reconcilePaymentAttempt`), and an abandoned BullMQ job
 * (`PaymentProcessor`'s `failed` listener) all call this instead of
 * hand-rolling the same three writes. Callers wrap this in
 * `runInTransaction` — it only needs the ambient `DbClientTag`, same as
 * every other use-case here.
 */
export const failPaymentAttempt = Effect.fn('failPaymentAttempt')(function* (
  input: FailPaymentAttemptInput,
): Effect.fn.Return<void, FailPaymentAttemptError, DbClientTag> {
  yield* updatePaymentAttempt({
    id: input.attempt.id,
    status: 'failed',
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
  });
  yield* upsertPayment({
    id: input.transaction.id,
    expectedVersion: input.transaction.version,
    status: 'failed',
  });
  yield* recordPaymentStatusHistory({
    paymentTransactionId: input.transaction.id,
    fromStatus: input.transaction.status,
    toStatus: 'failed',
    reason: input.failureCode,
  });
});
