import {
  index,
  integer,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../db/schema/users.schema';
import { paymentSchema } from './payment.pg-schema';

export const paymentTransactionTypeEnum = paymentSchema.enum(
  'payment_transaction_type',
  ['payment', 'refund', 'capture', 'void'],
);

export const paymentTransactionStatusEnum = paymentSchema.enum(
  'payment_transaction_status',
  [
    'pending',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'expired',
    'refund_pending',
    'refunded',
  ],
);

/**
 * One row per payment operation (a payment, a capture, a refund, a void) —
 * the seam between gateway processing and the ledger. Everything gateway-
 * facing (attempts, webhooks, status history) hangs off this row; once it
 * reaches a terminal success state, it posts at most one ledger_transaction.
 * `version` is optimistic-locking for concurrent status updates (e.g. a
 * webhook and a client poll racing).
 */
export const paymentTransactions = paymentSchema.table(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reference: text('reference').notNull(),
    idempotencyKey: text('idempotency_key'),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    type: paymentTransactionTypeEnum('type').notNull(),
    status: paymentTransactionStatusEnum('status').default('pending').notNull(),
    customerId: uuid('customer_id').references(() => users.id),
    // No orders table exists yet; left as a loose pointer to whatever the
    // payment is for (a subscription term, a listing boost, ...).
    orderId: uuid('order_id'),
    description: text('description'),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    // Postgres unique indexes ignore NULLs, so requests without a key never collide.
    uniqueIndex('payment_transactions_idempotency_key_uq').on(t.idempotencyKey),
    index('payment_transactions_customer_idx').on(t.customerId, t.createdAt),
    index('payment_transactions_status_idx').on(t.status, t.createdAt),
  ],
);

export type PaymentTransactionRow = typeof paymentTransactions.$inferSelect;
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert;
