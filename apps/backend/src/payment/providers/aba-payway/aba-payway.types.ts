/** ABA PayWay wire types — see `spec.md` for the endpoints. */

export interface AbaPaywayStatus {
  code: string;
  message: string;
  tran_id: string;
}

export interface CreatePurchaseRequest {
  req_time: string;
  merchant_id: string;
  /** Our short random id (≤ ~25 chars, a UUID is rejected). ABA echoes it back. */
  tran_id: string;
  amount: number;
  currency?: string;
  items?: string;
  payment_option?: string;
  return_url?: string;
  cancel_url?: string;
  continue_success_url?: string;
  custom_fields?: string;
  /** Minutes the checkout stays payable (min 3; ABA's default is 30 days). */
  lifetime?: number;
  hash: string;
}

export interface CreatePurchaseResponse {
  status: AbaPaywayStatus;
  /** Raw KHQR payload. */
  qrString?: string;
  /** Ready-to-display `data:image/png` URI. */
  qrImage?: string;
  abapay_deeplink?: string;
}

export interface CheckTransactionRequest {
  hash: string;
  merchant_id: string;
  req_time: string;
  tran_id: string;
}

export interface CheckTransactionData {
  apv?: string | null;
  discount_amount?: number | null;
  original_amount?: number | null;
  payment_amount?: number | null;
  payment_currency?: string | null;
  payment_status?: string | null;
  payment_status_code?: number | null;
  refund_amount?: number | null;
  total_amount?: number | null;
  transaction_date?: string | null;
}

/** `status` sits beside `data`, not inside it (as the live sandbox returns). */
export interface CheckTransactionResponse {
  data?: CheckTransactionData | null;
  status?: AbaPaywayStatus | null;
}

/** Callback ("Pushback Data") POSTed to `return_url`. */
export interface AbaPaywayWebhookPayload {
  tran_id: string;
  apv?: string;
  /** `0` = approved. Arrives as a number; other codes are undocumented. */
  status: number | string;
}
