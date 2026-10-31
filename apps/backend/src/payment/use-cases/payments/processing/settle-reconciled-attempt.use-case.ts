import { Effect } from 'effect';
import { DbClientTag, runInTransaction } from '../../../../db/db.provider';
import type { OutboxService } from '../../../../outbox/outbox.service';
import type {
  PaymentAttemptRow,
  PaymentTransactionRow,
  paymentTransactionStatusEnum,
} from '../../../entity';
import type { PaymentGatewayProvider } from '../../../providers/payment-gateway.interface';
import type { ChargeResult } from '../../../providers/payment-gateway.types';
import { PaymentPersistenceError } from '../errors';
import type { PaymentProcessingError } from '../errors';
import { updatePaymentAttempt } from '../attempt/update-payment-attempt.use-case';
import { upsertPaymentTransactionDetail } from '../transaction/upsert-payment-transaction-detail.use-case';
import { recordPaymentStatusHistory } from '../transaction/record-payment-status-history.use-case';
import { upsertPayment } from '../transaction/upsert-payment.use-case';
import { postPaymentSettlementLedger } from '../../ledgers';
import { enqueuePaymentSettledEvent } from './enqueue-payment-settled-event.use-case';

type TransactionStatus =
  (typeof paymentTransactionStatusEnum.enumValues)[number];

function nextTransactionStatus(
  attemptOutcome: 'succeeded' | 'failed',
): TransactionStatus {
  return attemptOutcome;
}

export interface SettleReconciledAttemptInput {
  attempt: PaymentAttemptRow;
  transaction: PaymentTransactionRow;
  provider: PaymentGatewayProvider;
  /** A terminal `reconcile()` answer — never `pending`. */
  result: ChargeResult & { status: 'succeeded' | 'failed' };
  /** Recorded on the status-history row: `poll`, `reconcile`, `late_payment`. */
  reason: string;
}

/**
 * Applies a terminal `reconcile()` answer in one DB transaction: detail row,
 * attempt, transaction status, status history, and — on success — the ledger
 * posting and the `payment.succeeded` outbox announcement. The one place a
 * poll round, the background reconciler, and a late-payment recovery all
 * settle through, so they cannot drift apart.
 *
 * Safe to race: `upsertPayment` is version-guarded (the loser gets a
 * `PaymentTransactionConflictError` and rolls back whole), the ledger post is
 * keyed on the transaction id, and the settled event on a dedupe key.
 *
 * Also settles an attempt that was already marked `failed` (poll expiry or an
 * abandoned job) — money that arrives after we gave up still has to count.
 */
export const settleReconciledAttempt = Effect.fn('settleReconciledAttempt')(
  function* (
    outbox: OutboxService,
    input: SettleReconciledAttemptInput,
  ): Effect.fn.Return<
    'succeeded' | 'failed',
    PaymentProcessingError,
    DbClientTag
  > {
    const { attempt, transaction, provider, result, reason } = input;
    const redactedRaw = provider.redact(result.rawResponse);
    const toStatus = nextTransactionStatus(result.status);
    const now = new Date();

    yield* runInTransaction(
      Effect.gen(function* () {
        yield* upsertPaymentTransactionDetail({
          paymentTransactionId: transaction.id,
          provider: attempt.provider,
          providerTransactionId: result.providerTransactionId,
          rawResponse: redactedRaw,
        });
        yield* updatePaymentAttempt({
          id: attempt.id,
          status: result.status,
          failureCode: result.failureCode,
          failureMessage: result.failureMessage,
          // A recovered attempt must not keep the failure it was wrongly
          // given (POLL_EXPIRED / POLL_GATEWAY_ERROR).
          clearFailure: result.status === 'succeeded',
        });
        yield* upsertPayment({
          id: transaction.id,
          expectedVersion: transaction.version,
          status: toStatus,
          completedAt: toStatus === 'succeeded' ? now : undefined,
        });
        yield* recordPaymentStatusHistory({
          paymentTransactionId: transaction.id,
          fromStatus: transaction.status,
          toStatus,
          reason,
        });
        if (toStatus === 'succeeded') {
          const ledgerTransaction = yield* postPaymentSettlementLedger(
            transaction,
            now,
          );
          if (ledgerTransaction) {
            yield* enqueuePaymentSettledEvent(
              outbox,
              transaction,
              ledgerTransaction,
            );
          }
        }
      }),
      (cause) => new PaymentPersistenceError({ cause }),
    );

    return result.status;
  },
);
