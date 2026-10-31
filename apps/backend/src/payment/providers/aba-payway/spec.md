# ABA PayWay API — what we use

Full docs: <https://developer.payway.com.kh>. Types live in `aba-payway.types.ts`;
hashes in `aba-payway.signing.ts`. Shapes below are what the sandbox actually
returns, which differs from ABA's written docs in places.

All calls are `POST` JSON to `ABA_PAYWAY_BASE_URL` with `Accept: application/json`.

## Purchase — `/api/payment-gateway/v1/payments/purchase`

Request (we send): `req_time`, `merchant_id`, `tran_id`, `amount`, `currency`,
`return_url` (base64), `continue_success_url`, `cancel_url`, `custom_fields`,
`lifetime`, `hash`. Unset optional fields are omitted, never `null`.

`lifetime` is minutes (min 3). If omitted the QR stays payable for 30 days; after
it elapses ABA rejects a KHQR payment and reverses the funds. It is the 21st
field in the hash.

Response:

```jsonc
{
  "status": { "code": "00", "message": "Success!", "tran_id": "…" },
  "qrString": "…", // raw KHQR payload
  "qrImage": "data:image/png;base64,…", // ready to display
  "abapay_deeplink": "abamobilebank://…",
}
```

`"00"` means the checkout was created, not paid. (There is no `checkout_qr_url`,
and `qr_string` is camelCase.)

## Check transaction — `/api/payment-gateway/v1/payments/check-transaction-2`

Request: `req_time`, `merchant_id`, `tran_id`, `hash`.

Response (`status` is a sibling of `data`):

```jsonc
{
  "status": { "code": "00", "message": "…", "tran_id": "…" },
  "data": {
    "payment_status_code": 0,
    "payment_status": "APPROVED",
    "payment_amount": 0.01,
    "…": "…",
  },
}
```

`status.code != "00"` means ABA doesn't know the `tran_id` yet. `payment_status_code`
`0` = approved; any other number = rejected.

## Callback — POSTed to `return_url`

Header `X-PayWay-Hmac-Sha512` (see signing in the README). The sandbox sends
only:

```json
{ "tran_id": "…", "apv": "…", "status": 0 }
```

ABA's docs list 20 fields (amounts, currency, payer…); don't rely on them
arriving. Reply `{ "code": 0 }`.

## Not implemented

`transaction-detail`, `close-transaction`, `transaction-list-2`. The first two
take the same body as check-transaction; nothing here needs them yet.
