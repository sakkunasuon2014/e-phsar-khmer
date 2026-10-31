import { Effect } from 'effect';
import { DbClientTag } from '../../../../db/db.provider';
import type { OutboxService } from '../../../../outbox/outbox.service';
import { PAYMENT_ATTEMPT_OUTBOX_EVENT_TYPE } from '../../../outbox/payment-outbox-events';
import {
  paymentAttempts,
  paymentAttemptMethodEnum,
  paymentTransactions,
  type PaymentAttemptRow,
  type PaymentTransactionRow,
} from '../../../entity';
import type { ProcessAttemptJobData } from '../../../queue/payment-queue.types';
import {
  DuplicateIdempotencyKeyError,
  PaymentPersistenceError,
  PaymentQueueError,
} from '../errors';

export interface CreatePaymentTransactionInput {
  transactionId?: string;
  reference: string;
  idempotencyKey?: string;
  amount: string;
  currency: string;
  customerId?: string;
  orderId?: string;
  description?: string;
  provider: string;
  method: (typeof paymentAttemptMethodEnum.enumValues)[number];
  browserReturnUrl?: string;
  browserCancelUrl?: string;
}

export interface CreatePaymentTransactionResult {
  transaction: PaymentTransactionRow;
  attempt: PaymentAttemptRow;
}

type CreatePaymentTransactionError =
  | DuplicateIdempotencyKeyError
  | PaymentPersistenceError
  | PaymentQueueError;

/** A `payment_transactions.idempotencyKey` unique-violation, not a generic write failure. */
function toCreatePaymentError(
  cause: unknown,
  idempotencyKey: string | undefined,
): DuplicateIdempotencyKeyError | PaymentPersistenceError {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? (cause as { code?: string }).code
      : undefined;
  if (code === '23505' && idempotencyKey) {
    return new DuplicateIdempotencyKeyError({ idempotencyKey });
  }
  return new PaymentPersistenceError({ cause });
}

/**
 * `POST /payments`'s whole write path: insert the transaction, insert its
 * first attempt, durably enqueue the attempt for processing. All three
 * steps used to be separate use-cases (`createPayment`, `createPaymentAttempt`,
 * `enqueuePaymentAttempt`) — folded in here because none of the three had a
 * second caller; splitting them only added indirection, not reuse. Compare
 * `checkPayment`, which stays separate because several different composed
 * flows actually call it.
 *
 * Must run inside `runInTransaction` (see `PaymentEffectRunner.runDurably`)
 * — all three inserts have to commit atomically.
 */
export const createPaymentTransaction = Effect.fn('createPaymentTransaction')(
  function* (
    outbox: OutboxService,
    input: CreatePaymentTransactionInput,
  ): Effect.fn.Return<
    CreatePaymentTransactionResult,
    CreatePaymentTransactionError,
    DbClientTag
  > {
    const db = yield* DbClientTag;

    const transactionRows = yield* Effect.tryPromise({
      try: () =>
        db
          .insert(paymentTransactions)
          .values({
            ...(input.transactionId ? { id: input.transactionId } : {}),
            reference: input.reference,
            idempotencyKey: input.idempotencyKey ?? null,
            amount: input.amount,
            currency: input.currency,
            type: 'payment',
            customerId: input.customerId ?? null,
            orderId: input.orderId ?? null,
            description: input.description ?? null,
          })
          .returning(),
      catch: (cause) => toCreatePaymentError(cause, input.idempotencyKey),
    });
    const [transaction] = transactionRows;

    const attemptRows = yield* Effect.tryPromise({
      try: () =>
        db
          .insert(paymentAttempts)
          .values({
            paymentTransactionId: transaction.id,
            provider: input.provider,
            method: input.method,
            amount: transaction.amount,
            currency: transaction.currency,
          })
          .returning(),
      catch: (cause) => new PaymentPersistenceError({ cause }),
    });
    const [attempt] = attemptRows;

    const enqueuePayload: ProcessAttemptJobData = {
      paymentTransactionId: transaction.id,
      paymentAttemptId: attempt.id,
      browserReturnUrl: input.browserReturnUrl,
      browserCancelUrl: input.browserCancelUrl,
    };
    yield* Effect.tryPromise({
      try: () =>
        outbox.enqueue(db, {
          eventType: PAYMENT_ATTEMPT_OUTBOX_EVENT_TYPE,
          aggregateType: 'payment_attempt',
          aggregateId: attempt.id,
          payload: enqueuePayload,
          dedupeKey: `payment-attempt-requested:${attempt.id}`,
        }),
      catch: (cause) => new PaymentQueueError({ cause }),
    });

    return { transaction, attempt };
  },
);
