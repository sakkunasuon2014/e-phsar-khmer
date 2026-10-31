/**
 * A leaf file with no imports, so payment.module.ts and payment.controller.ts
 * can both depend on it without a module <-> controller import cycle.
 * (`@InjectQueue(PAYMENT_QUEUE)` evaluates at class-decoration time — a
 * cyclic import previously left this `undefined` there, silently binding to
 * BullMQ's "default" queue instead of "payments".)
 */
export const PAYMENT_QUEUE = 'payments';

/**
 * Local, non-durable "a checkout was just issued and is waiting on the payer":
 * emitted by `PaymentProcessor` after a charge comes back `pending`, consumed
 * by `PaymentReconciler.arm()` to start polling now instead of at the next
 * safety sweep. Advisory only — Postgres stays the source of truth, so a lost
 * event (another instance, a restart) costs at most one sweep interval.
 */
export const PAYMENT_ISSUED_EVENT = 'payment.issued';
