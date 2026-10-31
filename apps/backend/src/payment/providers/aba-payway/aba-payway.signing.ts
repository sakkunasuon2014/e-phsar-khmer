import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA512, base64, keyed by the merchant API key. ABA uses three
 * different field layouts — they are not interchangeable.
 */
const hmac = (data: string, apiKey: string): string =>
  createHmac('sha512', apiKey).update(data, 'utf-8').digest('base64');

/**
 * check-transaction / transaction-detail: `req_time + merchant_id + tran_id`.
 * `null`/`undefined` values are skipped.
 */
export function signAbaPayway(values: unknown[], apiKey: string): string {
  return hmac(
    values
      .filter((value) => value !== null && value !== undefined)
      .map(String)
      .join(''),
    apiKey,
  );
}

/** Purchase fields, in the exact order ABA hashes them. */
export interface AbaPaywayPurchaseHashFields {
  reqTime: string;
  merchantId: string;
  tranId: string;
  amount: number | string;
  items?: string;
  shipping?: number | string;
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  type?: string;
  paymentOption?: string;
  returnUrl?: string;
  cancelUrl?: string;
  continueSuccessUrl?: string;
  returnDeeplink?: string;
  currency?: string;
  customFields?: string;
  returnParams?: string;
  payout?: string;
  lifetime?: number | string;
  additionalParams?: string;
  googlePayToken?: string;
  skipSuccessPage?: number | string;
}

/**
 * purchase: the 23 fields above concatenated in order. A missing field is
 * `''` at its position — skipping it would shift every later field. Pass the
 * values as sent (e.g. `returnUrl` already base64).
 */
export function signAbaPaywayPurchase(
  fields: AbaPaywayPurchaseHashFields,
  apiKey: string,
): string {
  const s = (value: string | number | undefined): string =>
    value === undefined ? '' : String(value);
  return hmac(
    s(fields.reqTime) +
      s(fields.merchantId) +
      s(fields.tranId) +
      s(fields.amount) +
      s(fields.items) +
      s(fields.shipping) +
      s(fields.firstname) +
      s(fields.lastname) +
      s(fields.email) +
      s(fields.phone) +
      s(fields.type) +
      s(fields.paymentOption) +
      s(fields.returnUrl) +
      s(fields.cancelUrl) +
      s(fields.continueSuccessUrl) +
      s(fields.returnDeeplink) +
      s(fields.currency) +
      s(fields.customFields) +
      s(fields.returnParams) +
      s(fields.payout) +
      s(fields.lifetime) +
      s(fields.additionalParams) +
      s(fields.googlePayToken) +
      s(fields.skipSuccessPage),
    apiKey,
  );
}

/**
 * Callback (`X-PayWay-Hmac-Sha512`): sort the payload's top-level keys,
 * concatenate the values (non-strings JSON-encoded), then sign.
 */
export function signAbaPaywayCallback(
  payload: Record<string, unknown>,
  apiKey: string,
): string {
  return hmac(
    Object.keys(payload)
      .sort()
      .map((key) => {
        const value = payload[key];
        return typeof value === 'string'
          ? value
          : (JSON.stringify(value) ?? '');
      })
      .join(''),
    apiKey,
  );
}

/** Constant-time compare; `timingSafeEqual` throws on unequal lengths. */
export function verifyAbaPaywayCallbackSignature(
  payload: Record<string, unknown>,
  apiKey: string,
  receivedSignature: string,
): boolean {
  const expected = Buffer.from(signAbaPaywayCallback(payload, apiKey));
  const received = Buffer.from(receivedSignature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
