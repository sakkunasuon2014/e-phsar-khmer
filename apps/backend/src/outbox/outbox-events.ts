/**
 * Local, non-durable wakeup signal: advisory only — PostgreSQL stays the source of truth.
 *
 * A producer emits this *after* its transaction commits; the listener turns
 * it into a capacity-1 wakeup token for the worker pool. EventEmitter is
 * in-process only, so the worker keeps a poll fallback as the safety net.
 */
export const OUTBOX_WAKEUP_EVENT = 'outbox.wakeup';
