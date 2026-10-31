import type {
  paymentAttemptMethodEnum,
  paymentAttemptStatusEnum,
} from '../entity/payment-attempt';

export type PaymentAttemptMethod =
  (typeof paymentAttemptMethodEnum.enumValues)[number];
export type PaymentAttemptOutcome =
  (typeof paymentAttemptStatusEnum.enumValues)[number];

/**
 * Every provider name a `payment_attempts.provider` row may actually
 * contain — the single source of truth for what `CreatePaymentDto.provider`
 * accepts and what `PaymentGatewayProvider.name` is allowed to be. The
 * column itself stays plain `text` (not a pg enum — see
 * `PaymentGatewayProvider`'s own doc comment), so this list, not the
 * schema, is what closes the "any string is accepted" gap.
 *
 * Add a new provider here in the same change that registers it in
 * `PAYMENT_GATEWAY_PROVIDERS` (`payment.module.ts`) — the two are meant to
 * stay in lockstep; nothing enforces that automatically.
 */
export const PAYMENT_PROVIDER_NAMES = ['aba_payway', 'bakong'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

/**
 * What PaymentProcessorService hands a provider to start a charge. Mirrors
 * the payment_attempts row already inserted (pending) before the provider
 * call is made — a provider never creates its own attempt record, it only
 * reports back what happened to this one.
 */
export interface ChargeRequest {
  attemptId: string;
  transactionId: string;
  reference: string;
  amount: string;
  currency: string;
  method: PaymentAttemptMethod;
  customerId?: string;
  description?: string;
  returnUrl?: string;
  cancelUrl?: string;
}

/**
 * What a provider hands back after a charge call. `rawResponse` is the
 * provider's own response shape, unredacted — callers must run it through
 * `PaymentGatewayProvider.redact()` before it touches
 * payment_transaction_details.rawResponse.
 */
export interface ChargeResult {
  status: PaymentAttemptOutcome;
  providerAttemptId?: string;
  providerTransactionId?: string;
  paymentMethodType?: string;
  maskedAccount?: string;
  redirectUrl?: string;
  failureCode?: string;
  failureMessage?: string;
  rawResponse: unknown;
  /**
   * Epoch ms after which the provider itself refuses payment. A pending
   * attempt is stored with it (`payment_transactions.expires_at`) and failed
   * once it passes plus a short grace. For a webhook-only provider (ABA) that
   * happens without asking the provider; for a polled one (Bakong, which has
   * no webhook at all and is driven by `PaymentReconciler`) the provider is
   * asked one last time first, so a payer at the deadline still settles.
   */
  expiresAt?: number;
}

export interface WebhookVerification {
  valid: boolean;
  reason?: string;
}

/**
 * A webhook body normalized into the shape payment_provider_events and the
 * status-transition logic need. `payload` is unredacted raw JSON — same
 * redact-before-persist rule as ChargeResult.rawResponse applies here.
 */
export interface ParsedProviderEvent {
  providerEventId: string;
  eventType: string;
  providerAttemptId?: string;
  status: PaymentAttemptOutcome | 'unknown';
  failureCode?: string;
  failureMessage?: string;
  payload: unknown;
}
