import { createHmac } from 'node:crypto';
import { AbaPaywayProvider } from './aba-payway.provider';
import { signAbaPayway, signAbaPaywayPurchase } from './aba-payway.signing';
import type {
  CheckTransactionRequest,
  CreatePurchaseRequest,
} from './aba-payway.types';

/**
 * Fully offline — nothing here can reach ABA: `createApiClient` is replaced
 * by a client whose `post` throws (every test asserts it was never called),
 * the two HTTP handlers are markers, `effect` is stubbed (ESM-only) so
 * `runPromise` just returns canned responses, and the hosts are `.invalid`.
 */
const mockNetworkPost = jest.fn((): never => {
  throw new Error('a network call was attempted from a unit test');
});
// Tests queue canned ABA responses with `mockResolvedValueOnce`.
const mockRunPromise = jest.fn(
  (...args: unknown[]): Promise<unknown> => Promise.resolve(args),
);
const mockCreateHandler = jest.fn((client: unknown, body: unknown) => ({
  op: 'create',
  client,
  body,
}));
const mockCheckHandler = jest.fn((client: unknown, body: unknown) => ({
  op: 'check',
  client,
  body,
}));

jest.mock('../../../utils/api-client', () => ({
  createApiClient: jest.fn(() => ({
    post: (...args: unknown[]) =>
      (mockNetworkPost as (...a: unknown[]) => never)(...args),
  })),
}));
jest.mock('effect', () => ({
  Effect: { runPromise: (effect: unknown) => mockRunPromise(effect) },
}));
jest.mock('./handlers/create-transaction.handler', () => ({
  createAbaPaywayTransaction: (client: unknown, body: unknown) =>
    mockCreateHandler(client, body),
}));
jest.mock('./handlers/check-transaction.handler', () => ({
  checkAbaPaywayTransaction: (client: unknown, body: unknown) =>
    mockCheckHandler(client, body),
}));

const API_KEY = 'unit-test-api-key-0123456789';
const MERCHANT_ID = 'merchant-1';
const WEBHOOK_URL =
  'https://backend.invalid/api/v1/payments/webhooks/aba-payway';

function makeProvider(overrides: Record<string, string | number> = {}) {
  const values: Record<string, string | number> = {
    'abaPayway.apiKey': API_KEY,
    'abaPayway.merchantId': MERCHANT_ID,
    'abaPayway.webhookUrl': WEBHOOK_URL,
    'abaPayway.baseUrl': 'https://aba.invalid',
    'abaPayway.lifetimeMinutes': 15,
    ...overrides,
  };
  return new AbaPaywayProvider({ get: (key: string) => values[key] } as never);
}

/**
 * ABA's documented PHP verify sample, reimplemented independently of
 * `signAbaPaywayCallback` — so a pass proves agreement with ABA, not with
 * ourselves.
 */
function abaSignature(payload: Record<string, unknown>, key = API_KEY) {
  const data = Object.keys(payload)
    .sort()
    .map((k) => {
      const v = payload[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v as string | number | boolean);
    })
    .join('');
  return createHmac('sha512', key).update(data, 'utf-8').digest('base64');
}

/** The 20-field callback ABA's docs describe. */
const callback = {
  tran_id: 'Ab-_9x7Qk2LmN4pRsT8v',
  apv: '832865',
  status: '0',
  return_params: '',
  original_amount: 10.5,
  original_currency: 'USD',
  payment_amount: 10.5,
  payment_currency: 'USD',
  total_amount: 10.5,
  discount_amount: 0,
  transaction_date: '2026-10-15 10:11:12',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  bank_ref: 'FT123456',
  payment_type: 'KHQR',
  payer_account: '',
  bank_name: 'ABA Bank',
  card_source: '',
};

const SIG = 'x-payway-hmac-sha512';

afterEach(() => {
  expect(mockNetworkPost).not.toHaveBeenCalled();
  jest.clearAllMocks();
  mockRunPromise.mockReset();
});

describe('AbaPaywayProvider.verifyWebhookSignature', () => {
  it('accepts the full 20-field callback signed per ABA’s algorithm', () => {
    const result = makeProvider().verifyWebhookSignature(
      JSON.stringify(callback),
      { [SIG]: abaSignature(callback) },
    );
    expect(result).toEqual({ valid: true });
  });

  // What the sandbox actually sent (2026-10-16): 3 fields, `status` a number.
  it('verifies and parses the real 3-field callback with numeric status 0', () => {
    const provider = makeProvider();
    const real = { tran_id: 'Mrqd64jAMzpdkDl3RVNk', apv: '123456', status: 0 };
    const raw = JSON.stringify(real);

    expect(
      provider.verifyWebhookSignature(raw, { [SIG]: abaSignature(real) }),
    ).toEqual({ valid: true });
    expect(provider.parseWebhookEvent(raw)).toMatchObject({
      status: 'succeeded',
      providerAttemptId: real.tran_id,
      providerEventId: `${real.tran_id}:0`,
    });
  });

  it('accepts a Buffer body the same as a string', () => {
    const result = makeProvider().verifyWebhookSignature(
      Buffer.from(JSON.stringify(callback)),
      { [SIG]: abaSignature(callback) },
    );
    expect(result.valid).toBe(true);
  });

  it('is independent of key order and of 10.50 vs 10.5 in the raw text', () => {
    const raw =
      '{"status":"0","payment_amount":10.50,"tran_id":"T1","apv":"1"}';
    const signed = {
      tran_id: 'T1',
      apv: '1',
      status: '0',
      payment_amount: 10.5,
    };
    const result = makeProvider().verifyWebhookSignature(raw, {
      [SIG]: abaSignature(signed),
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a payload altered after signing', () => {
    const result = makeProvider().verifyWebhookSignature(
      JSON.stringify({ ...callback, status: '1' }),
      { [SIG]: abaSignature(callback) },
    );
    expect(result).toEqual({ valid: false, reason: 'Signature mismatch' });
  });

  it('rejects an amount altered after signing', () => {
    const result = makeProvider().verifyWebhookSignature(
      JSON.stringify({ ...callback, payment_amount: 0.01 }),
      { [SIG]: abaSignature(callback) },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    const result = makeProvider().verifyWebhookSignature(
      JSON.stringify(callback),
      { [SIG]: abaSignature(callback, 'some-other-key') },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a wrong-length signature without throwing', () => {
    const result = makeProvider().verifyWebhookSignature(
      JSON.stringify(callback),
      { [SIG]: 'short' },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a missing header', () => {
    const result = makeProvider().verifyWebhookSignature(
      JSON.stringify(callback),
      {},
    );
    expect(result).toEqual({
      valid: false,
      reason: `Missing ${SIG} header`,
    });
  });

  it('fails closed when the API key is not configured — even for a signature made with the empty key', () => {
    const provider = makeProvider({ 'abaPayway.apiKey': '' });
    const result = provider.verifyWebhookSignature(JSON.stringify(callback), {
      [SIG]: abaSignature(callback, ''),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not configured/);
  });

  it.each(['', '{', 'not json'])(
    'rejects malformed JSON %p as a 401-able result',
    (raw) => {
      const result = makeProvider().verifyWebhookSignature(raw, {
        [SIG]: 'x',
      });
      expect(result).toEqual({ valid: false, reason: 'Malformed JSON body' });
    },
  );

  // `JSON.parse('null')` is valid JSON; `Object.keys(null)` used to throw out
  // of here as an unhandled 500 instead of a rejection.
  it.each(['null', '123', '"a string"', 'true', '[]', '[{"a":1}]'])(
    'rejects the non-object JSON body %p without throwing',
    (raw) => {
      const provider = makeProvider();
      expect(() =>
        provider.verifyWebhookSignature(raw, { [SIG]: 'x' }),
      ).not.toThrow();
      expect(provider.verifyWebhookSignature(raw, { [SIG]: 'x' })).toEqual({
        valid: false,
        reason: 'Malformed JSON body',
      });
    },
  );
});

describe('AbaPaywayProvider.parseWebhookEvent', () => {
  const parse = (body: unknown) =>
    makeProvider().parseWebhookEvent(JSON.stringify(body));

  it('parses an approved callback and correlates on tran_id', () => {
    const event = parse(callback);
    expect(event).toMatchObject({
      providerEventId: `${callback.tran_id}:0`,
      eventType: 'payment.notify',
      providerAttemptId: callback.tran_id,
      status: 'succeeded',
      failureCode: undefined,
      failureMessage: undefined,
    });
    expect(event.payload).toEqual(callback);
  });

  it.each(['0', '00', 0])('treats status %p as approved', (status) => {
    expect(parse({ tran_id: 'T', status }).status).toBe('succeeded');
  });

  it('treats a non-zero status as a rejection and keeps the code', () => {
    const event = parse({ tran_id: 'T', status: '2' });
    expect(event).toMatchObject({
      status: 'failed',
      failureCode: '2',
      providerEventId: 'T:2',
    });
  });

  // Number("") / Number(null) / Number(false) are all 0 — these used to be
  // read as approvals. They must never be.
  it.each([
    ['empty string', ''],
    ['whitespace', ' '],
    ['null', null],
    ['false', false],
    ['non-numeric text', 'abc'],
    ['missing', undefined],
  ])('maps a %s status to unknown, never succeeded', (_label, status) => {
    const body: Record<string, unknown> = { tran_id: 'T' };
    if (status !== undefined) body.status = status;
    const event = parse(body);
    expect(event.status).toBe('unknown');
    expect(event.failureCode).toBeUndefined();
  });

  it('gives retried deliveries the same event id and a different outcome a new one', () => {
    expect(parse({ tran_id: 'T', status: '0' }).providerEventId).toBe(
      parse({ tran_id: 'T', status: '0', apv: 'x' }).providerEventId,
    );
    expect(parse({ tran_id: 'T', status: '0' }).providerEventId).not.toBe(
      parse({ tran_id: 'T', status: '1' }).providerEventId,
    );
  });

  it.each([
    ['missing', { status: '0' }],
    ['empty', { tran_id: '', status: '0' }],
    ['blank', { tran_id: '   ', status: '0' }],
    ['a number', { tran_id: 123, status: '0' }],
    ['null', { tran_id: null, status: '0' }],
  ])('refuses a callback whose tran_id is %s', (_label, body) => {
    expect(() => parse(body)).toThrow(/no tran_id/);
  });

  it.each(['null', '[]', '123'])('refuses the non-object body %p', (raw) => {
    expect(() => makeProvider().parseWebhookEvent(raw)).toThrow();
  });
});

describe('AbaPaywayProvider.reconcile (canned responses, no network)', () => {
  it('reads status from the response’s top level and settles an approved payment', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '00', message: 'Success!', tran_id: 'T1' },
      data: { payment_status_code: 0, payment_status: 'APPROVED' },
    });

    const result = await makeProvider().reconcile('T1');

    expect(result).toMatchObject({
      status: 'succeeded',
      providerTransactionId: 'T1',
      failureCode: undefined,
    });
  });

  it('signs the check-transaction request with req_time + merchant_id + tran_id', async () => {
    mockRunPromise.mockResolvedValueOnce({ status: { code: '01' } });

    await makeProvider().reconcile('T1');

    const sent = mockCheckHandler.mock.calls[0][1] as CheckTransactionRequest;
    expect(sent.tran_id).toBe('T1');
    expect(sent.merchant_id).toBe(MERCHANT_ID);
    expect(sent.hash).toBe(
      signAbaPayway([sent.req_time, MERCHANT_ID, 'T1'], API_KEY),
    );
  });

  it('keeps a rejected payment’s code and ABA’s own status text', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '00', message: 'Success!', tran_id: 'T1' },
      data: { payment_status_code: 5, payment_status: 'DECLINED' },
    });

    expect(await makeProvider().reconcile('T1')).toMatchObject({
      status: 'failed',
      failureCode: '5',
      failureMessage: 'DECLINED',
    });
  });

  it('is inconclusive (pending) when ABA has no record yet', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '01', message: 'Transaction not found' },
    });
    expect((await makeProvider().reconcile('T1')).status).toBe('pending');
  });

  it('is inconclusive when the response carries no data block', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '00', tran_id: 'T1' },
    });
    expect((await makeProvider().reconcile('T1')).status).toBe('pending');
  });

  it('does not read the old nested `data.status` shape (regression)', async () => {
    mockRunPromise.mockResolvedValueOnce({
      data: {
        payment_status_code: 0,
        status: { code: '00', tran_id: 'T1' },
      },
    });
    expect((await makeProvider().reconcile('T1')).status).toBe('pending');
  });

  it('refuses to run unconfigured, before building any request', async () => {
    await expect(
      makeProvider({ 'abaPayway.apiKey': '' }).reconcile('T1'),
    ).rejects.toThrow(/not configured/);
    expect(mockCheckHandler).not.toHaveBeenCalled();
  });
});

describe('AbaPaywayProvider.charge (canned responses, no network)', () => {
  const request = {
    attemptId: 'attempt-1',
    transactionId: 'txn-uuid-1',
    reference: 'ref-1',
    amount: '10.50',
    currency: 'USD',
    method: 'wallet' as const,
    returnUrl: 'https://shop.invalid/success',
    cancelUrl: 'https://shop.invalid/cancel',
  };

  it('signs exactly the values it sends (return_url base64, other URLs plain)', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '00', message: 'Success!', tran_id: 'ignored' },
      abapay_deeplink: 'abamobilebank://pay',
    });

    await makeProvider().charge(request);

    const sent = mockCreateHandler.mock.calls[0][1] as CreatePurchaseRequest;
    expect(sent.return_url).toBe(
      Buffer.from(WEBHOOK_URL, 'utf-8').toString('base64'),
    );
    expect(sent.continue_success_url).toBe(request.returnUrl);
    expect(sent.cancel_url).toBe(request.cancelUrl);
    expect(sent.custom_fields).toBe(request.transactionId);
    expect(sent.amount).toBe(10.5);
    expect(sent.lifetime).toBe(15);
    expect(sent.tran_id.length).toBeLessThanOrEqual(25);
    expect(sent.hash).toBe(
      signAbaPaywayPurchase(
        {
          reqTime: sent.req_time,
          merchantId: sent.merchant_id,
          tranId: sent.tran_id,
          amount: sent.amount,
          returnUrl: sent.return_url,
          cancelUrl: sent.cancel_url,
          continueSuccessUrl: sent.continue_success_url,
          currency: sent.currency,
          customFields: sent.custom_fields,
          lifetime: sent.lifetime,
        },
        API_KEY,
      ),
    );
  });

  it('sends the configured lifetime and returns the matching expiry', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '00', tran_id: 'T1' },
      qrString: 'KHQR…',
    });
    const before = Date.now();

    const result = await makeProvider({
      'abaPayway.lifetimeMinutes': 30,
    }).charge(request);

    const sent = mockCreateHandler.mock.calls[0][1] as CreatePurchaseRequest;
    expect(sent.lifetime).toBe(30);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    // The checkout countdown reads `expiresAt` from the stored response.
    expect(result.rawResponse).toMatchObject({
      qrString: 'KHQR…',
      expiresAt: result.expiresAt,
    });
  });

  it('omits unset optional URLs from the body instead of sending null', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '00', tran_id: 'T9' },
    });

    await makeProvider().charge({
      ...request,
      returnUrl: undefined,
      cancelUrl: undefined,
    });

    const sent = mockCreateHandler.mock.calls[0][1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('continue_success_url');
    expect(sent).not.toHaveProperty('cancel_url');
  });

  it('returns pending with ABA’s echoed tran_id on an accepted purchase', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '00', message: 'Success!', tran_id: 'T-ECHO' },
      abapay_deeplink: 'abamobilebank://pay',
    });

    expect(await makeProvider().charge(request)).toMatchObject({
      status: 'pending',
      providerAttemptId: 'T-ECHO',
      redirectUrl: 'abamobilebank://pay',
    });
  });

  it('returns failed with ABA’s code when the purchase is refused', async () => {
    mockRunPromise.mockResolvedValueOnce({
      status: { code: '2', message: 'Invalid hash' },
    });

    expect(await makeProvider().charge(request)).toMatchObject({
      status: 'failed',
      failureCode: '2',
      failureMessage: 'Invalid hash',
    });
  });

  it('refuses to charge without a webhook URL, before building any request', async () => {
    await expect(
      makeProvider({ 'abaPayway.webhookUrl': '' }).charge(request),
    ).rejects.toThrow(/ABA_PAYWAY_WEBHOOK_URL/);
    expect(mockCreateHandler).not.toHaveBeenCalled();
  });
});

describe('AbaPaywayProvider is webhook-only', () => {
  it('trusts a verified webhook instead of polling ABA', () => {
    expect(makeProvider().trustsVerifiedWebhook).toBe(true);
  });

  it('is not available without a webhook URL, so the picker hides it', () => {
    expect(makeProvider().isConfigured()).toBe(true);
    expect(makeProvider({ 'abaPayway.webhookUrl': '' }).isConfigured()).toBe(
      false,
    );
  });

  it('rejects callbacks while the webhook URL is unset (fails closed)', () => {
    const provider = makeProvider({ 'abaPayway.webhookUrl': '' });
    const result = provider.verifyWebhookSignature(JSON.stringify(callback), {
      [SIG]: abaSignature(callback),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ABA_PAYWAY_WEBHOOK_URL/);
  });
});
