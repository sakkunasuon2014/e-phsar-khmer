import type {
  ChargeRequest,
  ChargeResult,
  ParsedProviderEvent,
  PaymentProviderName,
  WebhookVerification,
} from './payment-gateway.types';

/**
 * One implementation per bank/gateway (ABA PayWay, Wing, ACLEDA, ...). The
 * `name` must match the plain `provider` text column already stored on
 * payment_attempts / payment_transaction_details / payment_provider_events —
 * PaymentGatewayRegistry resolves on it, so it's the provider's own identity,
 * not a display label. Typed against `PaymentProviderName` rather than
 * `string` so a new provider can't silently drift from the allowlist
 * `CreatePaymentDto.provider` validates against — registering one means
 * adding its name to `PAYMENT_PROVIDER_NAMES` first, or this won't compile.
 */
export interface PaymentGatewayProvider {
  readonly name: PaymentProviderName;

  /** Human-readable label for the checkout's provider picker. */
  readonly displayName: string;

  charge(request: ChargeRequest): Promise<ChargeResult>;

  /**
   * Asks the provider what it currently knows about an already-created
   * attempt, keyed by the id `charge()` sent as the provider-facing
   * reference. Two callers: corroborating a webhook that carries no
   * signature (a provider may not sign its callbacks at all), and
   * recovering a checkout after an ambiguous `charge()` failure before
   * risking a second charge opportunity on retry. Optional — omit for a
   * provider with no such lookup.
   */
  reconcile?(providerTransactionId: string): Promise<ChargeResult>;

  /**
   * The provider's webhook is signed, so once `verifyWebhookSignature` passes
   * its status is final: `processProviderEvent` settles on it directly instead
   * of calling `reconcile()` (a webhook-only provider has no polling).
   */
  readonly trustsVerifiedWebhook?: boolean;

  /**
   * Whether this provider has the credentials it needs to actually call
   * out (e.g. an API key/merchant id from env config) — not whether it's
   * registered (that's `PaymentGatewayRegistry.resolve` succeeding at
   * all). Optional: a provider whose calls can't fail this way (or that
   * hasn't needed the distinction yet) can omit it, and callers must treat
   * a missing implementation as "assume configured" rather than block on
   * it. `processProviderEvent` uses this to short-circuit before
   * `reconcile()`, so a missing key settles the event as a clear failure
   * instead of surfacing only as a thrown Error retried opaquely by BullMQ.
   */
  isConfigured?(): boolean;

  verifyWebhookSignature(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): WebhookVerification;

  parseWebhookEvent(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): ParsedProviderEvent;

  /**
   * Strips whatever this provider's raw payloads carry that shouldn't sit in
   * Postgres verbatim (full PAN, bank account numbers, auth tokens) before
   * the caller persists rawResponse / payload as jsonb. Redaction is
   * provider-specific because each gateway's response shape is different —
   * there is no generic scrubber that knows every provider's field names.
   */
  redact(payload: unknown): unknown;
}

export const PAYMENT_GATEWAY_PROVIDERS = Symbol('PAYMENT_GATEWAY_PROVIDERS');
