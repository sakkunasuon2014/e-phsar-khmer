import { Effect } from 'effect';
import { DbClientTag, runInTransaction } from '../../../../db/db.provider';
import type { OutboxService } from '../../../../outbox/outbox.service';
import type { paymentTransactionStatusEnum } from '../../../entity';
import { PaymentGatewayRegistryTag } from '../../../providers/payment-gateway-registry.provider';
import type { ProcessAttemptJobData } from '../../../queue/payment-queue.types';
import { PaymentGatewayCallError, PaymentPersistenceError } from '../errors';
import type { PaymentProcessingError } from '../errors';
import { failPaymentAttempt } from './fail-payment-attempt.use-case';
import { findPaymentAttempt } from '../attempt/find-payment-attempt.use-case';
import { checkPayment } from '../transaction/check-payment.use-case';
import { updatePaymentAttempt } from '../attempt/update-payment-attempt.use-case';
import { upsertPaymentTransactionDetail } from '../transaction/upsert-payment-transaction-detail.use-case';
import { recordPaymentStatusHistory } from '../transaction/record-payment-status-history.use-case';
import { upsertPayment } from '../transaction/upsert-payment.use-case';
import { postPaymentSettlementLedger } from '../../ledgers';
import { enqueuePaymentSettledEvent } from './enqueue-payment-settled-event.use-case';

export type ProcessPaymentAttemptOutcome =
  | 'skipped'
  | 'gateway_not_registered'
  | 'gateway_not_configured'
  | 'pending'
  | 'succeeded'
  | 'failed';

type TransactionStatus =
  (typeof paymentTransactionStatusEnum.enumValues)[number];

function nextTransactionStatus(
  attemptOutcome: 'pending' | 'succeeded' | 'failed',
): TransactionStatus {
  if (attemptOutcome === 'pending') return 'processing';
  return attemptOutcome;
}

/**
 * Turns a committed, `pending` payment_attempt into a provider charge — the
 * only place that calls a gateway for initiation. Redelivered jobs for an
 * already-resolved attempt no-op. An unregistered gateway is a wiring
 * mistake, not transient, so it fails the attempt outright instead of
 * retrying; a gateway call that produces no answer throws
 * `PaymentGatewayCallError` so BullMQ's backoff retries instead.
 *
 * A `pending` result for a provider with no webhook (Bakong) schedules
 * nothing here: the caller announces `payment.issued` after this commits and
 * `PaymentReconciler` — the one poller — picks the attempt up from the
 * database.
 */
export const processPaymentAttempt = Effect.fn('processPaymentAttempt')(
  function* (
    outbox: OutboxService,
    input: ProcessAttemptJobData,
  ): Effect.fn.Return<
    ProcessPaymentAttemptOutcome,
    PaymentProcessingError,
    DbClientTag | PaymentGatewayRegistryTag
  > {
    const attempt = yield* findPaymentAttempt(input.paymentAttemptId);
    if (attempt.status !== 'pending') {
      return 'skipped';
    }

    const transaction = yield* checkPayment(input.paymentTransactionId);
    const registry = yield* PaymentGatewayRegistryTag;

    let provider: ReturnType<typeof registry.resolve> | undefined;
    try {
      provider = registry.resolve(attempt.provider);
    } catch {
      provider = undefined;
    }

    if (!provider) {
      yield* runInTransaction(
        failPaymentAttempt({
          attempt,
          transaction,
          failureCode: 'PROVIDER_NOT_REGISTERED',
          failureMessage: `No payment gateway registered for provider "${attempt.provider}"`,
        }),
        (cause) => new PaymentPersistenceError({ cause }),
      );
      return 'gateway_not_registered';
    }

    // Missing credentials, not just unregistered — same give-up treatment.
    if (provider.isConfigured && !provider.isConfigured()) {
      yield* runInTransaction(
        failPaymentAttempt({
          attempt,
          transaction,
          failureCode: 'GATEWAY_NOT_CONFIGURED',
          failureMessage: `Payment gateway "${attempt.provider}" is not configured`,
        }),
        (cause) => new PaymentPersistenceError({ cause }),
      );
      return 'gateway_not_configured';
    }

    // Outside the DB transaction — a gateway HTTP call shouldn't hold locks.
    const result = yield* Effect.tryPromise({
      try: () =>
        provider.charge({
          attemptId: attempt.id,
          transactionId: transaction.id,
          reference: transaction.reference,
          amount: attempt.amount,
          currency: attempt.currency,
          method: attempt.method,
          customerId: transaction.customerId ?? undefined,
          description: transaction.description ?? undefined,
          returnUrl: input.browserReturnUrl,
          cancelUrl: input.browserCancelUrl,
        }),
      catch: (cause) => new PaymentGatewayCallError({ cause }),
    });

    const redactedRaw = provider.redact(result.rawResponse);
    const toStatus = nextTransactionStatus(result.status);

    yield* runInTransaction(
      Effect.gen(function* () {
        yield* upsertPaymentTransactionDetail({
          paymentTransactionId: transaction.id,
          provider: attempt.provider,
          providerTransactionId: result.providerTransactionId,
          paymentMethodType: result.paymentMethodType,
          maskedAccount: result.maskedAccount,
          redirectUrl: result.redirectUrl,
          rawResponse: redactedRaw,
        });
        yield* updatePaymentAttempt({
          id: attempt.id,
          status: result.status,
          providerAttemptId: result.providerAttemptId,
          failureCode: result.failureCode,
          failureMessage: result.failureMessage,
        });

        if (toStatus !== transaction.status) {
          const now = new Date();
          yield* upsertPayment({
            id: transaction.id,
            expectedVersion: transaction.version,
            status: toStatus,
            completedAt: toStatus === 'succeeded' ? now : undefined,
            expiresAt: result.expiresAt
              ? new Date(result.expiresAt)
              : undefined,
          });
          yield* recordPaymentStatusHistory({
            paymentTransactionId: transaction.id,
            fromStatus: transaction.status,
            toStatus,
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
        }
      }),
      (cause) => new PaymentPersistenceError({ cause }),
    );

    return result.status;
  },
);
