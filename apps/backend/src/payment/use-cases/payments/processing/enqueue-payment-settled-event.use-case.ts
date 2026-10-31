import { Effect } from 'effect';
import { DbClientTag } from '../../../../db/db.provider';
import type { OutboxService } from '../../../../outbox/outbox.service';
import { PAYMENT_SETTLED_OUTBOX_EVENT_TYPE } from '../../../outbox/payment-outbox-events';
import type {
  LedgerTransactionRow,
  PaymentTransactionRow,
} from '../../../entity';
import { PaymentQueueError } from '../errors';

type EnqueuePaymentSettledEventError = PaymentQueueError;

export interface PaymentSettledEventPayload {
  paymentTransactionId: string;
  ledgerTransactionId: string;
  orderId: string | null;
  customerId: string | null;
  amount: string;
  currency: string;
  occurredAt: string;
}

/**
 * Announces a settled payment to the rest of the system — consumed today by
 * `PaymentSettledOutboxHandler` (`../../outbox/payment-settled-outbox-handler.ts`).
 * Callers must invoke this only after `postPaymentSettlementLedger` actually
 * produced a `ledgerTransaction`, inside the same `runInTransaction` block —
 * the announcement commits with the ledger posting or not at all.
 * `dedupeKey` mirrors `ledger_transactions.idempotencyKey`, so a redelivered
 * job can't double-write this event either.
 */
export const enqueuePaymentSettledEvent = Effect.fn(
  'enqueuePaymentSettledEvent',
)(function* (
  outbox: OutboxService,
  transaction: PaymentTransactionRow,
  ledgerTransaction: LedgerTransactionRow,
): Effect.fn.Return<void, EnqueuePaymentSettledEventError, DbClientTag> {
  const db = yield* DbClientTag;
  const payload: PaymentSettledEventPayload = {
    paymentTransactionId: transaction.id,
    ledgerTransactionId: ledgerTransaction.id,
    orderId: transaction.orderId,
    customerId: transaction.customerId,
    amount: transaction.amount,
    currency: transaction.currency,
    occurredAt: ledgerTransaction.occurredAt.toISOString(),
  };
  yield* Effect.tryPromise({
    try: () =>
      outbox.enqueue(db, {
        eventType: PAYMENT_SETTLED_OUTBOX_EVENT_TYPE,
        aggregateType: 'payment_transaction',
        aggregateId: transaction.id,
        payload,
        dedupeKey: `payment-succeeded:${transaction.id}`,
      }),
    catch: (cause) => new PaymentQueueError({ cause }),
  });
});
