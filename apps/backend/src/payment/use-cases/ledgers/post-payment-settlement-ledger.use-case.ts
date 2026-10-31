import { Effect } from 'effect';
import { DbClientTag } from '../../../db/db.provider';
import type { PaymentTransactionRow, LedgerTransactionRow } from '../../entity';
import { PaymentPersistenceError } from '../payments';
import { LedgerImbalanceError } from './errors';
import { findOrCreateSystemLedgerAccount } from './find-or-create-ledger-account.use-case';
import { postLedgerTransaction } from './post-ledger-transaction.use-case';

type PostPaymentSettlementLedgerError =
  | LedgerImbalanceError
  | PaymentPersistenceError;

/**
 * Chart-of-accounts mapping for a payment_transaction that just reached a
 * terminal `succeeded` status: debit the provider-clearing asset account
 * (money the gateway now owes the platform), credit platform revenue. Only
 * `transactionType: 'payment'` is handled — that's the only type
 * `PaymentsController.create()` can ever produce today (refund/capture/void
 * have no creation path yet, so their mapping would be speculative; see the
 * module README's Open items). `occurredAt` is passed in rather than read
 * from `Date.now()` here so it matches the `completedAt` the caller is
 * writing onto the same payment_transaction in the same DB transaction.
 *
 * Callers are expected to already be inside a runInTransaction block, same
 * as every other write in the three success-transition use-cases
 * (processPaymentAttempt / processProviderEvent / settleReconciledAttempt) —
 * the ledger posting commits or rolls back together with the status flip
 * that made it true.
 */
export const postPaymentSettlementLedger = Effect.fn(
  'postPaymentSettlementLedger',
)(function* (
  transaction: PaymentTransactionRow,
  occurredAt: Date,
): Effect.fn.Return<
  LedgerTransactionRow | null,
  PostPaymentSettlementLedgerError,
  DbClientTag
> {
  if (transaction.type !== 'payment') {
    return null;
  }

  const providerClearing = yield* findOrCreateSystemLedgerAccount({
    code: `provider_clearing:${transaction.currency}`,
    name: `Provider Clearing (${transaction.currency})`,
    accountType: 'asset',
    currency: transaction.currency,
  });
  const platformRevenue = yield* findOrCreateSystemLedgerAccount({
    code: `platform_revenue:${transaction.currency}`,
    name: `Platform Revenue (${transaction.currency})`,
    accountType: 'revenue',
    currency: transaction.currency,
  });

  const { ledgerTransaction } = yield* postLedgerTransaction({
    paymentTransactionId: transaction.id,
    reference: transaction.reference,
    transactionType: 'payment',
    currency: transaction.currency,
    description: `Payment settled: ${transaction.reference}`,
    idempotencyKey: transaction.id,
    occurredAt,
    entries: [
      {
        accountId: providerClearing.id,
        entryType: 'debit',
        amount: transaction.amount,
      },
      {
        accountId: platformRevenue.id,
        entryType: 'credit',
        amount: transaction.amount,
      },
    ],
  });

  return ledgerTransaction;
});
