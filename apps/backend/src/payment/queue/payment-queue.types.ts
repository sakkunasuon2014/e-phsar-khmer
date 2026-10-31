/**
 * Job names and payloads for the `payments` BullMQ queue. Three distinct
 * lifecycle steps share one queue: dispatching a payment_attempt against a
 * provider, processing an already-received payment_provider_event, and the
 * retired `poll-attempt` job (kept only so one queued before the switch to
 * `PaymentReconciler` completes cleanly — see `PaymentProcessor`).
 * Consumed by `PaymentProcessor` (`../processors/payment.processor.ts`).
 */

export const PAYMENT_ATTEMPT_JOB = 'process-attempt';
export const PAYMENT_EVENT_JOB = 'process-provider-event';
export const PAYMENT_POLL_JOB = 'poll-attempt';

export interface ProcessAttemptJobData {
  paymentTransactionId: string;
  paymentAttemptId: string;
  /**
   * The payer's post-checkout browser redirect (e.g. ABA PayWay
   * `continue_success_url`) — NOT a webhook/callback target, which is
   * fixed server config (see AbaPaywayProvider.charge()), never
   * request-scoped. Carried through the outbox row and the BullMQ job
   * payload rather than a DB column — only needed for the one `charge()`
   * call this job makes.
   */
  browserReturnUrl?: string;
  /**
   * The payer's browser redirect on cancel (e.g. ABA PayWay `cancel_url`).
   * Same carry-through rationale as `browserReturnUrl` above.
   */
  browserCancelUrl?: string;
}

export interface ProcessProviderEventJobData {
  paymentProviderEventId: string;
}

/**
 * Legacy payload of the retired poll chain. Nothing produces it any more;
 * the type remains for `PaymentPollOutboxHandler` and the `poll-attempt` job
 * branch, which only drain rows and jobs written before the switch.
 */
export interface PollAttemptJobData {
  paymentTransactionId: string;
  paymentAttemptId: string;
  /** The provider's base interval; the back-off schedule is derived from it. */
  intervalMs: number;
  expiresAt: number;
  /** Rounds already run. Absent on the first round and on older queued payloads. */
  round?: number;
  /** Delay for THIS round when it differs from `intervalMs` (back-off). */
  delayMs?: number;
}

export type PaymentJobData =
  | ProcessAttemptJobData
  | ProcessProviderEventJobData
  | PollAttemptJobData;
