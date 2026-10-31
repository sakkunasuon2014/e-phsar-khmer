import {
  RECOVERABLE_FAILURE_CODES,
  isPendingAbandoned,
  isReconcilable,
  nextTickDelayMs,
} from './reconcile-policy';

describe('isReconcilable', () => {
  it('always reconciles a pending attempt', () => {
    expect(isReconcilable({ status: 'pending', failureCode: null })).toBe(true);
  });

  it.each(RECOVERABLE_FAILURE_CODES)(
    'revisits an attempt we failed by timeout (%s) — it may still have been paid',
    (failureCode) => {
      expect(isReconcilable({ status: 'failed', failureCode })).toBe(true);
    },
  );

  it.each([
    'CHARGE_GATEWAY_ERROR', // no QR ever existed — nothing to pay
    'PROVIDER_NOT_REGISTERED',
    'GATEWAY_NOT_CONFIGURED',
    'SOMETHING_ELSE',
  ])('does not revisit a genuine failure (%s)', (failureCode) => {
    expect(isReconcilable({ status: 'failed', failureCode })).toBe(false);
  });

  it('does not revisit a failed attempt with no failure code', () => {
    expect(isReconcilable({ status: 'failed', failureCode: null })).toBe(false);
  });

  it('never revisits a succeeded attempt', () => {
    expect(isReconcilable({ status: 'succeeded', failureCode: null })).toBe(
      false,
    );
  });
});

describe('isPendingAbandoned', () => {
  const NOW = 1_000_000_000_000;
  const GRACE = 30_000;
  const BACKSTOP = 15 * 60_000;
  const base = { now: NOW, graceMs: GRACE, abandonAfterMs: BACKSTOP };

  it('keeps polling until the checkout expiry plus grace has passed', () => {
    expect(
      isPendingAbandoned({
        ...base,
        createdAt: new Date(NOW - 60_000),
        expiresAt: new Date(NOW + 240_000),
      }),
    ).toBe(false);
  });

  it('keeps polling inside the grace window after expiry, so a payer at the deadline still settles', () => {
    expect(
      isPendingAbandoned({
        ...base,
        createdAt: new Date(NOW - 300_000),
        expiresAt: new Date(NOW - GRACE + 1),
      }),
    ).toBe(false);
  });

  it('abandons once the checkout expiry plus grace has passed — long before the age backstop', () => {
    expect(
      isPendingAbandoned({
        ...base,
        createdAt: new Date(NOW - 331_000),
        expiresAt: new Date(NOW - GRACE),
      }),
    ).toBe(true);
  });

  it('falls back to the age backstop when no expiry was recorded', () => {
    const recent = { ...base, createdAt: new Date(NOW - 60_000) };
    expect(isPendingAbandoned({ ...recent, expiresAt: null })).toBe(false);
    expect(
      isPendingAbandoned({
        ...base,
        createdAt: new Date(NOW - BACKSTOP),
        expiresAt: null,
      }),
    ).toBe(true);
  });

  it('still honours the age backstop when the recorded expiry is far in the future', () => {
    expect(
      isPendingAbandoned({
        ...base,
        createdAt: new Date(NOW - BACKSTOP),
        expiresAt: new Date(NOW + 24 * 60 * 60_000),
      }),
    ).toBe(true);
  });
});

describe('nextTickDelayMs', () => {
  const options = {
    fastIntervalMs: 5_000,
    fastWindowMs: 60_000,
    baseIntervalMs: 15_000,
    idleIntervalMs: 60_000,
  };
  const idle = {
    pending: 0,
    newestPendingAgeMs: null,
    didWork: false,
  };

  it('polls quickly while the newest pending checkout is still young', () => {
    expect(
      nextTickDelayMs(
        { pending: 1, newestPendingAgeMs: 10_000, didWork: false },
        options,
      ),
    ).toBe(5_000);
  });

  it('relaxes to the base interval once every pending checkout is past the fast window', () => {
    expect(
      nextTickDelayMs(
        { pending: 3, newestPendingAgeMs: 60_000, didWork: false },
        options,
      ),
    ).toBe(15_000);
  });

  it('goes to the idle interval when nothing is pending and nothing happened', () => {
    expect(nextTickDelayMs(idle, options)).toBe(60_000);
  });

  it('looks again at the base interval right after it did something', () => {
    expect(nextTickDelayMs({ ...idle, didWork: true }, options)).toBe(15_000);
  });

  it('never idles faster than the base interval, whatever the configuration', () => {
    expect(nextTickDelayMs(idle, { ...options, idleIntervalMs: 1_000 })).toBe(
      15_000,
    );
  });
});
