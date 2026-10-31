import {
  toPaymentAttemptOutcome,
  webhookStatusToOutcome,
} from './aba-payway.status';

describe('webhookStatusToOutcome', () => {
  it.each(['0', '00', ' 0 ', 0])('treats %p as approved', (status) => {
    expect(webhookStatusToOutcome(status)).toBe('succeeded');
  });

  it.each(['1', '2', '99', 1, 99])(
    'treats the non-zero code %p as a rejection',
    (status) => {
      expect(webhookStatusToOutcome(status)).toBe('failed');
    },
  );

  // `Number()` turns "", " ", null and false into 0 — an approval the
  // payload never made. None of these is a status code at all.
  it.each(['', ' ', null, false, true, undefined, 'abc', '0x0', '1.5', '-1'])(
    'treats %p as unknown, never an approval',
    (status) => {
      expect(webhookStatusToOutcome(status)).toBe('unknown');
    },
  );

  it.each([1.5, -1, NaN, Infinity])(
    'treats the non-integer / negative number %p as unknown',
    (status) => {
      expect(webhookStatusToOutcome(status)).toBe('unknown');
    },
  );
});

describe('toPaymentAttemptOutcome', () => {
  it('maps payment_status_code 0 to succeeded regardless of text', () => {
    expect(toPaymentAttemptOutcome(0, 'anything')).toBe('succeeded');
    expect(toPaymentAttemptOutcome(0, null)).toBe('succeeded');
  });

  it('maps approved text statuses to succeeded when no code is present', () => {
    expect(toPaymentAttemptOutcome(null, 'APPROVED')).toBe('succeeded');
    expect(toPaymentAttemptOutcome(undefined, 'success')).toBe('succeeded');
    expect(toPaymentAttemptOutcome(null, 'Completed')).toBe('succeeded');
  });

  it('maps pending text statuses to pending', () => {
    expect(toPaymentAttemptOutcome(null, 'PENDING')).toBe('pending');
    expect(toPaymentAttemptOutcome(null, 'processing')).toBe('pending');
  });

  it('maps a non-zero numeric code with unrecognised text to failed', () => {
    expect(toPaymentAttemptOutcome(1, 'SOMETHING_ELSE')).toBe('failed');
    expect(toPaymentAttemptOutcome(99, null)).toBe('failed');
  });

  it('defaults to pending when nothing is recognisable', () => {
    expect(toPaymentAttemptOutcome(null, null)).toBe('pending');
    expect(toPaymentAttemptOutcome(undefined, undefined)).toBe('pending');
    expect(toPaymentAttemptOutcome(null, 'UNKNOWN_TEXT')).toBe('pending');
  });
});
