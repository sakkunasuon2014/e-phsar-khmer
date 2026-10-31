import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { DbClientTag } from '../../../../db/db.provider';
import {
  paymentAttempts,
  paymentAttemptStatusEnum,
  type PaymentAttemptRow,
} from '../../../entity';
import { PaymentPersistenceError } from '../errors';

export interface UpdatePaymentAttemptInput {
  id: string;
  status: (typeof paymentAttemptStatusEnum.enumValues)[number];
  providerAttemptId?: string;
  failureCode?: string;
  failureMessage?: string;
  /** Null the failure columns — an attempt recovered after being failed. */
  clearFailure?: boolean;
}

type UpdatePaymentAttemptError = PaymentPersistenceError;

/**
 * Records the outcome of a gateway call on the attempt row that made it.
 * `respondedAt` is always stamped `now()` here — this is only ever called
 * once the provider has actually answered (or been given up on).
 */
export const updatePaymentAttempt = Effect.fn('updatePaymentAttempt')(
  function* (
    input: UpdatePaymentAttemptInput,
  ): Effect.fn.Return<
    PaymentAttemptRow,
    UpdatePaymentAttemptError,
    DbClientTag
  > {
    const db = yield* DbClientTag;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db
          .update(paymentAttempts)
          .set({
            status: input.status,
            respondedAt: new Date(),
            ...(input.providerAttemptId !== undefined
              ? { providerAttemptId: input.providerAttemptId }
              : {}),
            ...(input.clearFailure
              ? { failureCode: null, failureMessage: null }
              : {}),
            ...(input.failureCode !== undefined
              ? { failureCode: input.failureCode }
              : {}),
            ...(input.failureMessage !== undefined
              ? { failureMessage: input.failureMessage }
              : {}),
          })
          .where(eq(paymentAttempts.id, input.id))
          .returning(),
      catch: (cause) => new PaymentPersistenceError({ cause }),
    });
    const [row] = rows;
    return row;
  },
);
