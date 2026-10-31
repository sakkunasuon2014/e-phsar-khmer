import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChargeRequest,
  ChargeResult,
  ParsedProviderEvent,
  WebhookVerification,
} from '../payment-gateway.types';
import type { PaymentGatewayProvider } from '../payment-gateway.interface';
import { createApiClient, type ApiClient } from '../../../utils/api-client';
import {
  base64EncodeAbaPaywayUrl,
  formatAbaPaywayReqTime,
} from './aba-payway.encoding';
import {
  signAbaPayway,
  signAbaPaywayPurchase,
  verifyAbaPaywayCallbackSignature,
} from './aba-payway.signing';
import {
  ABA_PAYWAY_API_OK,
  toPaymentAttemptOutcome,
  webhookStatusToOutcome,
} from './aba-payway.status';
import { createAbaPaywayTransaction } from './handlers/create-transaction.handler';
import { checkAbaPaywayTransaction } from './handlers/check-transaction.handler';
import type {
  AbaPaywayWebhookPayload,
  CheckTransactionRequest,
  CreatePurchaseRequest,
} from './aba-payway.types';
import { Effect } from 'effect';

// Node lowercases incoming header names.
const SIGNATURE_HEADER = 'x-payway-hmac-sha512';

/**
 * ABA PayWay gateway — the only place that knows PayWay's wire format.
 *
 * The `tran_id` sent to ABA is a short random id, not one of our UUIDs (ABA
 * rejects more than ~25 chars). ABA echoes it back everywhere, and it is
 * stored as `payment_attempts.provider_attempt_id` to correlate webhooks and
 * reconciles to an attempt. See `README.md`.
 */
@Injectable()
export class AbaPaywayProvider implements PaymentGatewayProvider {
  readonly name = 'aba_payway';
  readonly displayName = 'ABA PayWay';
  /** The callback is HMAC-signed, so it is settled on directly (no polling). */
  readonly trustsVerifiedWebhook = true;
  private readonly apiClient: ApiClient;

  constructor(private readonly configService: ConfigService) {
    this.apiClient = createApiClient({
      baseUrl: this.baseUrl(),
      // Without `Accept: application/json` ABA answers purchase with an HTML
      // checkout page instead of JSON.
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  /** 15 random bytes as base64url = exactly 20 chars. */
  private generateTranId(): string {
    return randomBytes(15).toString('base64url');
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const webhookUrl = this.webhookUrl();
    if (!webhookUrl) {
      throw new Error(
        'ABA PayWay is not configured — set ABA_PAYWAY_WEBHOOK_URL (the ' +
          'server-to-server return_url ABA needs to report a payment ' +
          'outcome; without it a purchase would have nowhere to notify)',
      );
    }
    this.ensureConfigured();

    const reqTime = formatAbaPaywayReqTime(new Date());
    const merchantId = this.merchantId();
    const tranId = this.generateTranId();
    const amount = Number(request.amount);
    const currency = request.currency;
    // ABA rejects payment after this; without it the QR lives for 30 days.
    const lifetime = this.lifetimeMinutes();
    const expiresAt = Date.now() + lifetime * 60_000;

    // `return_url` is ABA's server-to-server callback target: always our own
    // config, never caller input, and the only base64-encoded URL.
    const returnUrl = base64EncodeAbaPaywayUrl(webhookUrl);
    // The payer's browser redirects, sent plain.
    const continueSuccessUrl = request.returnUrl;
    const cancelUrl = request.cancelUrl;

    // Sign exactly what is sent below. Unset positions sign as '' (see
    // `signAbaPaywayPurchase`).
    const hash = signAbaPaywayPurchase(
      {
        reqTime,
        merchantId,
        tranId,
        amount,
        returnUrl,
        cancelUrl: cancelUrl ?? undefined,
        continueSuccessUrl: continueSuccessUrl ?? undefined,
        currency,
        customFields: request.transactionId,
        lifetime,
      },
      this.apiKey(),
    );

    const body: CreatePurchaseRequest = {
      req_time: reqTime,
      merchant_id: merchantId,
      tran_id: tranId,
      amount,
      currency,
      return_url: returnUrl,
      // Omit unset fields: sending `null` would not match the '' we signed.
      ...(continueSuccessUrl
        ? { continue_success_url: continueSuccessUrl }
        : {}),
      ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
      // Our transaction id, for manual lookups in ABA's tooling only.
      custom_fields: request.transactionId,
      lifetime,
      hash,
    };

    const response = await Effect.runPromise(
      createAbaPaywayTransaction(this.apiClient, body),
    );

    if (response.status?.code !== ABA_PAYWAY_API_OK) {
      return {
        status: 'failed',
        failureCode: response.status?.code,
        failureMessage:
          response.status?.message ??
          `ABA PayWay refused the purchase (code ${response.status?.code ?? 'unknown'})`,
        rawResponse: response,
      };
    }

    // "00" = checkout created, not paid: stays `pending` until the webhook
    // arrives or the checkout expires. The KHQR (`qrString`/`qrImage`) travels
    // in `rawResponse` (with `expiresAt`, for the checkout countdown).
    return {
      status: 'pending',
      providerAttemptId: response.status.tran_id,
      providerTransactionId: response.status.tran_id,
      redirectUrl: response.abapay_deeplink,
      expiresAt,
      rawResponse: { ...response, expiresAt },
    };
  }

  async reconcile(providerTransactionId: string): Promise<ChargeResult> {
    this.ensureConfigured();
    const reqTime = formatAbaPaywayReqTime(new Date());
    const merchantId = this.merchantId();

    const request: CheckTransactionRequest = {
      req_time: reqTime,
      merchant_id: merchantId,
      tran_id: providerTransactionId,
      hash: signAbaPayway(
        [reqTime, merchantId, providerTransactionId],
        this.apiKey(),
      ),
    };

    // A network failure rejects; the use-case layer turns it into a retry.
    const response = await Effect.runPromise(
      checkAbaPaywayTransaction(this.apiClient, request),
    );

    // A non-"00" status means ABA doesn't know the tran_id (yet):
    // inconclusive, not a rejection.
    if (response.status?.code !== ABA_PAYWAY_API_OK || !response.data) {
      return { status: 'pending', rawResponse: response };
    }

    const data = response.data;
    const status = toPaymentAttemptOutcome(
      data.payment_status_code,
      data.payment_status,
    );

    return {
      status,
      providerTransactionId: response.status.tran_id ?? providerTransactionId,
      failureCode:
        status === 'failed' ? String(data.payment_status_code) : undefined,
      failureMessage:
        status === 'failed' ? (data.payment_status ?? undefined) : undefined,
      rawResponse: response,
    };
  }

  verifyWebhookSignature(
    rawBody: Buffer | string,
    headers: Record<string, string>,
  ): WebhookVerification {
    // Fail closed: with no key, a signature made with key '' would pass.
    if (!this.isConfigured()) {
      return {
        valid: false,
        reason:
          'ABA PayWay is not configured — set ABA_PAYWAY_API_KEY, ABA_PAYWAY_MERCHANT_ID and ABA_PAYWAY_WEBHOOK_URL',
      };
    }

    const received = headers[SIGNATURE_HEADER];
    if (!received) {
      return { valid: false, reason: `Missing ${SIGNATURE_HEADER} header` };
    }

    let payload: Record<string, unknown>;
    try {
      const text =
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
      const parsed: unknown = JSON.parse(text);
      // Valid JSON but never a callback; `Object.keys(null)` would throw.
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return { valid: false, reason: 'Malformed JSON body' };
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return { valid: false, reason: 'Malformed JSON body' };
    }

    return verifyAbaPaywayCallbackSignature(payload, this.apiKey(), received)
      ? { valid: true }
      : { valid: false, reason: 'Signature mismatch' };
  }

  parseWebhookEvent(rawBody: Buffer | string): ParsedProviderEvent {
    const text =
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    const body = JSON.parse(text) as AbaPaywayWebhookPayload | null;

    // No tran_id = nothing to correlate, and a shared `undefined:0` dedupe key.
    if (
      !body ||
      typeof body.tran_id !== 'string' ||
      body.tran_id.trim() === ''
    ) {
      throw new Error('ABA PayWay callback has no tran_id');
    }

    const status = webhookStatusToOutcome(body.status);

    return {
      // A retry of the same outcome dedupes; a different status is a new event.
      providerEventId: `${body.tran_id}:${body.status ?? ''}`,
      eventType: 'payment.notify',
      providerAttemptId: body.tran_id,
      status,
      failureCode: status === 'failed' ? String(body.status).trim() : undefined,
      // The callback has no failure text; reconcile() supplies it.
      failureMessage: undefined,
      payload: body,
    };
  }

  /** ABA's responses carry no PAN or token (`payer_account` is pre-masked). */
  redact(payload: unknown): unknown {
    return payload;
  }

  private apiKey(): string {
    return this.configService.get<string>('abaPayway.apiKey') ?? '';
  }

  private webhookUrl(): string {
    return this.configService.get<string>('abaPayway.webhookUrl') ?? '';
  }

  private merchantId(): string {
    return this.configService.get<string>('abaPayway.merchantId') ?? '';
  }

  private baseUrl(): string {
    return (
      this.configService.get<string>('abaPayway.baseUrl') ??
      'https://checkout-sandbox.payway.com.kh'
    );
  }

  private lifetimeMinutes(): number {
    return this.configService.get<number>('abaPayway.lifetimeMinutes') ?? 15;
  }

  /**
   * Needs the webhook URL too: ABA is webhook-only, so without one a payment
   * could never confirm. Unconfigured, the checkout picker hides ABA.
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey() && this.merchantId() && this.webhookUrl());
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        'ABA PayWay is not configured — set ABA_PAYWAY_API_KEY, ABA_PAYWAY_MERCHANT_ID and ABA_PAYWAY_WEBHOOK_URL',
      );
    }
  }
}
