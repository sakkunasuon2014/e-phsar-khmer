import type { PaymentAttemptOutcome } from '../payment-gateway.types';

/** `status.code` on an ABA response: the API call worked (not the payment). */
export const ABA_PAYWAY_API_OK = '00';

/** `payment_status_code` for an approved payment. */
const PAYMENT_APPROVED_CODE = 0;

const APPROVED_TEXT = ['APPROVED', 'SUCCESS', 'COMPLETED'];
const PENDING_TEXT = ['PENDING', 'PRE-AUTH', 'PREAUTH', 'PROCESSING'];

/**
 * Maps check-transaction's status onto `payment_attempts.status`. The code
 * wins; the text is the fallback. `failed` only on an explicit non-zero code —
 * anything ambiguous stays `pending`.
 */
export function toPaymentAttemptOutcome(
  paymentStatusCode?: number | null,
  paymentStatus?: string | null,
): PaymentAttemptOutcome {
  if (paymentStatusCode === PAYMENT_APPROVED_CODE) {
    return 'succeeded';
  }

  const normalized = paymentStatus?.trim().toUpperCase() ?? '';

  if (APPROVED_TEXT.includes(normalized)) return 'succeeded';
  if (PENDING_TEXT.includes(normalized)) return 'pending';

  if (typeof paymentStatusCode === 'number') return 'failed';

  return 'pending';
}

/**
 * Maps the callback's `status` (a number in practice, `0` = approved; a
 * string is accepted too). Only a plain non-negative integer is a code —
 * anything else (`""`, `null`, `false`, `"abc"`, missing) is `unknown`.
 * Don't use `Number()` here: it turns `""`/`null`/`false` into `0`, an
 * approval the payload never made.
 */
export function webhookStatusToOutcome(
  status: unknown,
): PaymentAttemptOutcome | 'unknown' {
  let code: number;
  if (typeof status === 'number') {
    code = status;
  } else if (typeof status === 'string' && /^\d+$/.test(status.trim())) {
    code = Number(status.trim());
  } else {
    return 'unknown';
  }
  if (!Number.isInteger(code) || code < 0) return 'unknown';
  return toPaymentAttemptOutcome(code, null);
}
