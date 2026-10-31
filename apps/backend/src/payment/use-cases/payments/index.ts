export * from './errors';

// payment_transactions (+ its 1:1 detail satellite and status audit trail)
// create-payment, find-payment-transaction-detail folded into the
// processing/ flows below — each had exactly one caller.
export * from './transaction/check-payment.use-case';
export * from './transaction/list-payments.use-case';
export * from './transaction/upsert-payment.use-case';
export * from './transaction/upsert-payment-transaction-detail.use-case';
export * from './transaction/record-payment-status-history.use-case';

// payment_attempts
// create-payment-attempt, enqueue-payment-attempt, list-payment-attempts
// folded into the processing/ flows below — each had exactly one caller.
export * from './attempt/find-payment-attempt.use-case';
export * from './attempt/find-payment-attempt-by-provider-attempt-id.use-case';
export * from './attempt/update-payment-attempt.use-case';

// payment_provider_events
// create-payment-provider-event, enqueue-payment-provider-event,
// find-payment-provider-event folded into the processing/ flows below —
// each had exactly one caller.
export * from './provider-event/settle-payment-provider-event.use-case';

// Composed, multi-entity flows — the actual business logic the controller
// and the BullMQ processor call. Everything above this line is a
// single-table primitive with more than one caller (or a controller-facing
// read simple enough to need no composition); everything below composes
// several primitives — some of them fully inlined rather than left as a
// separate single-caller file — into one business action.
export * from './processing/create-payment-transaction.use-case';
export * from './processing/receive-payment-provider-event.use-case';
export * from './processing/check-owned-payment-transaction.use-case';
export * from './processing/list-owned-payment-attempts.use-case';
export * from './processing/process-payment-attempt.use-case';
export * from './processing/process-provider-event.use-case';
export * from './processing/settle-reconciled-attempt.use-case';
export * from './processing/reconcile-payment-attempt.use-case';
export * from './processing/fail-payment-attempt.use-case';
export * from './processing/expire-payment-attempt.use-case';
export * from './processing/fail-abandoned-payment-job.use-case';
export * from './processing/enqueue-payment-settled-event.use-case';
