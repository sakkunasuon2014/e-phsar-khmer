import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { DbClientTag, runInTransaction } from '../../../../db/db.provider';
import type { OutboxService } from '../../../../outbox/outbox.service';
import {
  paymentProviderEvents,
  type paymentTransactionStatusEnum,
} from '../../../entity';
import { PaymentGatewayRegistryTag } from '../../../providers/payment-gateway-registry.provider';
import type { ChargeResult } from '../../../providers/payment-gateway.types';
import type { ProcessProviderEventJobData } from '../../../queue/payment-queue.types';
import {
  PaymentGatewayCallError,
  PaymentPersistenceError,
  PaymentProviderEventNotFoundError,
} from '../errors';
import type { PaymentProcessingError } from '../errors';
import { settlePaymentProviderEvent } from '../provider-event/settle-payment-provider-event.use-case';
import { findPaymentAttempt } from '../attempt/find-payment-attempt.use-case';
import { checkPayment } from '../transaction/check-payment.use-case';
import { updatePaymentAttempt } from '../attempt/update-payment-attempt.use-case';
import { upsertPaymentTransactionDetail } from '../transaction/upsert-payment-transaction-detail.use-case';
import { recordPaymentStatusHistory } from '../transaction/record-payment-status-history.use-case';
import { upsertPayment } from '../transaction/upsert-payment.use-case';
import { postPaymentSettlementLedger } from '../../ledgers';
import { enqueuePaymentSettledEvent } from './enqueue-payment-settled-event.use-case';
import { resolveProviderEventFailure } from './provider-event-failure';

export type ProcessProviderEventOutcome =
  | 'skipped'
  | 'ignored_uncorrelated'
  | 'ignored_already_settled'
  | 'ignored_unconfirmed'
  | 'gateway_not_registered'
  | 'gateway_not_configured'
  | 'succeeded'
  | 'failed'
  | 'pending';

type TransactionStatus =
  (typeof paymentTransactionStatusEnum.enumValues)[number];

function nextTransactionStatus(
  attemptOutcome: 'pending' | 'succeeded' | 'failed',
): TransactionStatus {
  if (attemptOutcome === 'pending') return 'processing';
  return attemptOutcome;
}

/**
 * Applies a received payment_provider_event to the attempt/transaction it
 * correlates to. The event row is whatever a `@Public()` webhook route
 * received, so before acting on it the gateway is asked directly what it
 * currently knows (`reconcile()`) — defense in depth for a signed webhook,
 * and the only check for a provider whose webhook carries no signature. A
 * gateway with no `reconcile()` trusts the re-parsed payload directly.
 */
export const processProviderEvent = Effect.fn('processProviderEvent')(
  function* (
    outbox: OutboxService,
    input: ProcessProviderEventJobData,
  ): Effect.fn.Return<
    ProcessProviderEventOutcome,
    PaymentProcessingError,
    DbClientTag | PaymentGatewayRegistryTag
  > {
    const db = yield* DbClientTag;
    const eventRows = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(paymentProviderEvents)
          .where(eq(paymentProviderEvents.id, input.paymentProviderEventId)),
      catch: (cause) => new PaymentPersistenceError({ cause }),
    });
    const event = eventRows[0];
    if (!event) {
      return yield* new PaymentProviderEventNotFoundError({
        id: input.paymentProviderEventId,
      });
    }
    if (event.status !== 'received') {
      return 'skipped';
    }

    if (!event.paymentAttemptId) {
      yield* settlePaymentProviderEvent({ id: event.id, status: 'ignored' });
      return 'ignored_uncorrelated';
    }

    const attempt = yield* findPaymentAttempt(event.paymentAttemptId);
    const transaction = yield* checkPayment(attempt.paymentTransactionId);

    if (attempt.status !== 'pending') {
      // Already resolved — a later delivery for the same attempt is a duplicate.
      yield* settlePaymentProviderEvent({ id: event.id, status: 'ignored' });
      return 'ignored_already_settled';
    }

    const registry = yield* PaymentGatewayRegistryTag;
    let provider: ReturnType<typeof registry.resolve> | undefined;
    try {
      provider = registry.resolve(event.provider);
    } catch {
      provider = undefined;
    }

    if (!provider) {
      yield* settlePaymentProviderEvent({ id: event.id, status: 'failed' });
      return 'gateway_not_registered';
    }

    // Checked directly so a missing credential is a clear outcome, not an
    // opaque thrown Error retried until reconcile() eventually fails anyway.
    if (provider.isConfigured && !provider.isConfigured()) {
      yield* settlePaymentProviderEvent({ id: event.id, status: 'failed' });
      return 'gateway_not_configured';
    }

    const parsed = provider.parseWebhookEvent(
      JSON.stringify(event.payload),
      {},
    );
    const reconcileRef = parsed.providerAttemptId ?? attempt.providerAttemptId;

    let outcome: 'pending' | 'succeeded' | 'failed' =
      parsed.status === 'unknown' ? 'pending' : parsed.status;
    let rawResponse: unknown = event.payload;
    let reconciledResult: ChargeResult | undefined;

    if (provider.reconcile && reconcileRef && !provider.trustsVerifiedWebhook) {
      reconciledResult = yield* Effect.tryPromise({
        try: () => provider.reconcile!(reconcileRef),
        catch: (cause) => new PaymentGatewayCallError({ cause }),
      });
      // Authoritative — overrides whatever the webhook claimed, signed or not.
      outcome = reconciledResult.status;
      rawResponse = reconciledResult.rawResponse ?? rawResponse;
    }

    if (outcome === 'pending') {
      // Not yet corroborated — marked ignored (not processed, not retried
      // forever); a future delivery/reconcile is what resolves this.
      yield* settlePaymentProviderEvent({ id: event.id, status: 'ignored' });
      return 'ignored_unconfirmed';
    }

    const redactedRaw = provider.redact(rawResponse);
    const toStatus = nextTransactionStatus(outcome);
    const failure = resolveProviderEventFailure(
      outcome,
      parsed,
      reconciledResult,
    );
    const now = new Date();

    yield* runInTransaction(
      Effect.gen(function* () {
        yield* upsertPaymentTransactionDetail({
          paymentTransactionId: transaction.id,
          provider: event.provider,
          rawResponse: redactedRaw,
        });
        yield* updatePaymentAttempt({
          id: attempt.id,
          status: outcome,
          failureCode: failure.failureCode,
          failureMessage: failure.failureMessage,
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
          reason: 'payment_provider_event',
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
        yield* settlePaymentProviderEvent({
          id: event.id,
          status: 'processed',
        });
      }),
      (cause) => new PaymentPersistenceError({ cause }),
    );

    return outcome;
  },
);
