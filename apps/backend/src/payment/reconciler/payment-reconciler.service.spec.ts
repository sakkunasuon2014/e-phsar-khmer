import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PaymentReconciler } from './payment-reconciler.service';
import type { ReconcileSummary } from './payment-reconciler.service';
import { runExpireAttempt, runReconcileAttempt } from './run-reconcile-attempt';

// The Effect bridge is mocked at its Promise boundary — `effect` is ESM-only
// and Jest never needs to load it to test the sweep's own logic.
jest.mock('./run-reconcile-attempt', () => ({
  runReconcileAttempt: jest.fn(),
  runExpireAttempt: jest.fn(),
}));

const reconcileMock = runReconcileAttempt as unknown as jest.Mock;
const expireMock = runExpireAttempt as unknown as jest.Mock;

/**
 * A drizzle-style query chain that resolves `rows` at `.limit()`. Every
 * `.orderBy()` and `.limit()` argument is recorded when a sink is given, so a
 * spec can assert how a query is ordered and capped without a database.
 */
function chain(
  rows: unknown[],
  sink?: { orderBy: unknown[][]; limit: unknown[] },
) {
  const self: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where']) {
    self[method] = jest.fn(() => self);
  }
  self.orderBy = jest.fn((...args: unknown[]) => {
    sink?.orderBy.push(args);
    return self;
  });
  self.limit = jest.fn((n: unknown) => {
    sink?.limit.push(n);
    return Promise.resolve(rows);
  });
  return self;
}

const MINUTE = 60_000;

/** Renders recorded `.orderBy()` arguments the way Postgres would see them. */
function renderOrderBy(args: unknown[]): string {
  return new PgDialect().sqlToQuery(sql.join(args as SQL[], sql`, `)).sql;
}

function build(opts: {
  stuck?: unknown[];
  expired?: unknown[];
  /** Still-`pending` attempts, the payers actually waiting. */
  candidates?: unknown[];
  /** Attempts we failed by timeout that stay re-checkable for the grace window. */
  recoverable?: unknown[];
  providers?: string[];
  activate?: jest.Mock;
  pendingSink?: { orderBy: unknown[][]; limit: unknown[] };
  recoverableSink?: { orderBy: unknown[][]; limit: unknown[] };
}) {
  const db = {
    select: jest
      .fn()
      // In call order: purchases awaiting activation, expired webhook-only
      // attempts, pending attempts, then recoverable-failed attempts.
      .mockReturnValueOnce(chain(opts.stuck ?? []))
      .mockReturnValueOnce(chain(opts.expired ?? []))
      .mockReturnValueOnce(chain(opts.candidates ?? [], opts.pendingSink))
      .mockReturnValueOnce(chain(opts.recoverable ?? [], opts.recoverableSink)),
  };
  const outbox = { wakeupAfterCommit: jest.fn() };
  const activation = {
    activatePaidPurchase:
      opts.activate ?? jest.fn().mockResolvedValue({ status: 'activated' }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'payment.reconcileProviders'
        ? (opts.providers ?? ['bakong'])
        : undefined,
    ),
  };
  const reconciler = new PaymentReconciler(
    db as never,
    {} as never,
    outbox as never,
    activation as never,
    config as never,
  );
  return { reconciler, db, outbox, activation };
}

const attempt = (id: string, ageMs: number) => ({
  id,
  createdAt: new Date(Date.now() - ageMs),
});

describe('PaymentReconciler.runOnce', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    expireMock.mockReset();
  });

  it('settles an unresolved attempt and wakes the outbox so activation follows', async () => {
    reconcileMock.mockResolvedValue('succeeded');
    const { reconciler, outbox } = build({
      candidates: [attempt('a1', 2 * MINUTE)],
    });

    const summary = await reconciler.runOnce();

    expect(summary).toMatchObject({ checked: 1, settled: 1, errors: 0 });
    expect(outbox.wakeupAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('counts an attempt abandoned after the checkout expired unpaid', async () => {
    reconcileMock.mockResolvedValue('abandoned');
    const { reconciler, outbox } = build({
      candidates: [attempt('a1', 20 * MINUTE)],
    });

    const summary = await reconciler.runOnce();

    expect(summary).toMatchObject({ abandoned: 1, settled: 0 });
    expect(outbox.wakeupAfterCommit).not.toHaveBeenCalled();
  });

  it('does not count a lost race (reported as skipped) as an error', async () => {
    reconcileMock.mockResolvedValue('skipped');
    const { reconciler } = build({ candidates: [attempt('a1', MINUTE)] });

    const summary = await reconciler.runOnce();

    expect(summary).toMatchObject({ checked: 1, settled: 0, errors: 0 });
  });

  it('survives a gateway failure and keeps going with the next attempt', async () => {
    reconcileMock
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce('succeeded');
    const { reconciler } = build({
      candidates: [attempt('a1', MINUTE), attempt('a2', 2 * MINUTE)],
    });

    const summary = await reconciler.runOnce();

    expect(summary).toMatchObject({ checked: 2, settled: 1, errors: 1 });
  });

  it('reports the pending attempts that are still unpaid, and the newest one`s age', async () => {
    reconcileMock
      .mockResolvedValueOnce('still_pending')
      .mockResolvedValueOnce('succeeded');
    const { reconciler } = build({
      candidates: [attempt('fresh', 10_000), attempt('paid', 40_000)],
    });

    const summary = await reconciler.runOnce();

    expect(summary.pending).toBe(1);
    expect(summary.newestPendingAgeMs).toBeGreaterThanOrEqual(10_000);
    expect(summary.newestPendingAgeMs).toBeLessThan(11_000);
  });

  it('keeps an attempt whose provider call failed in the live count, so it is retried soon', async () => {
    reconcileMock.mockResolvedValue('error');
    const { reconciler } = build({ candidates: [attempt('a1', MINUTE)] });

    expect((await reconciler.runOnce()).pending).toBe(1);
  });

  it('does not count settled, abandoned or race-lost attempts as live', async () => {
    reconcileMock
      .mockResolvedValueOnce('succeeded')
      .mockResolvedValueOnce('abandoned')
      .mockResolvedValueOnce('skipped');
    const { reconciler } = build({
      candidates: [attempt('a', 1), attempt('b', 2), attempt('c', 3)],
    });

    const summary = await reconciler.runOnce();

    expect(summary.pending).toBe(0);
    expect(summary.newestPendingAgeMs).toBeNull();
  });

  it('never lets a recoverable-failed attempt keep the tight loop alive', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    const { reconciler } = build({
      recoverable: [attempt('late', 10 * MINUTE)],
    });

    const summary = await reconciler.runOnce();

    expect(summary).toMatchObject({ checked: 1, pending: 0 });
  });

  it('activates a purchase whose payment already settled, with no provider call', async () => {
    const { reconciler, activation } = build({
      stuck: [
        {
          purchaseId: 'p1',
          paymentTransactionId: 't1',
          customerId: 'u1',
          amount: '0.20',
          currency: 'USD',
        },
      ],
    });

    const summary = await reconciler.runOnce();

    expect(summary.activated).toBe(1);
    expect(activation.activatePaidPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseId: 'p1', paymentTransactionId: 't1' }),
    );
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('does not count an already-paid purchase, and survives an activation error', async () => {
    const activate = jest
      .fn()
      .mockResolvedValueOnce({ status: 'already_paid' })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ status: 'activated' });
    const row = (id: string) => ({
      purchaseId: id,
      paymentTransactionId: `t-${id}`,
      customerId: 'u1',
      amount: '0.20',
      currency: 'USD',
    });
    const { reconciler } = build({
      stuck: [row('p1'), row('p2'), row('p3')],
      activate,
    });

    const summary = await reconciler.runOnce();

    expect(activate).toHaveBeenCalledTimes(3);
    expect(summary.activated).toBe(1);
  });

  it('still finishes activation when no provider is configured to poll', async () => {
    const { reconciler, db, activation } = build({
      stuck: [
        {
          purchaseId: 'p1',
          paymentTransactionId: 't1',
          customerId: 'u1',
          amount: '0.20',
          currency: 'USD',
        },
      ],
      providers: [],
    });

    const summary = await reconciler.runOnce();

    expect(activation.activatePaidPurchase).toHaveBeenCalledTimes(1);
    expect(summary.checked).toBe(0);
    // activation + expiry only — the candidates query is skipped.
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

describe('PaymentReconciler.runOnce — candidate selection', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    expireMock.mockReset();
  });

  it('reads pending attempts newest-first, so a live payer is never starved by old ones', async () => {
    const pendingSink = { orderBy: [] as unknown[][], limit: [] as unknown[] };
    const { reconciler } = build({ pendingSink });

    await reconciler.runOnce();

    expect(pendingSink.orderBy).toHaveLength(1);
    const order = renderOrderBy(pendingSink.orderBy[0]);
    expect(order).toContain('desc');
    expect(order).not.toContain('asc');
  });

  it('reads the recoverable-failed tail newest-first as well', async () => {
    const recoverableSink = {
      orderBy: [] as unknown[][],
      limit: [] as unknown[],
    };
    const { reconciler } = build({ recoverableSink });

    await reconciler.runOnce();

    expect(recoverableSink.orderBy).toHaveLength(1);
    const order = renderOrderBy(recoverableSink.orderBy[0]);
    expect(order).toContain('desc');
    expect(order).not.toContain('asc');
  });

  it('caps the recoverable tail on its own, so it cannot crowd pending attempts out', async () => {
    const pendingSink = { orderBy: [] as unknown[][], limit: [] as unknown[] };
    const recoverableSink = {
      orderBy: [] as unknown[][],
      limit: [] as unknown[],
    };
    const { reconciler } = build({ pendingSink, recoverableSink });

    await reconciler.runOnce();

    expect(pendingSink.limit).toEqual([100]);
    expect(recoverableSink.limit).toHaveLength(1);
    expect(recoverableSink.limit[0]).toBeLessThanOrEqual(50);
  });

  it('checks a pending attempt even when the recoverable tail is full', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    const tail = Array.from({ length: 50 }, (_, i) =>
      attempt(`late-${i}`, 5 * MINUTE),
    );
    const { reconciler } = build({
      candidates: [attempt('live-payer', MINUTE)],
      recoverable: tail,
    });

    const summary = await reconciler.runOnce();

    expect(summary.candidates).toBe(51);
    expect(summary.checked).toBe(51);
    expect(reconcileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentAttemptId: 'live-payer' }),
    );
  });

  it('checks pending attempts before the recoverable tail', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    const { reconciler } = build({
      candidates: [attempt('live', MINUTE)],
      recoverable: [attempt('late', 5 * MINUTE)],
    });

    await reconciler.runOnce();

    const order = reconcileMock.mock.calls.map(
      (call: [unknown, { paymentAttemptId: string }]) =>
        call[1].paymentAttemptId,
    );
    expect(order).toEqual(['live', 'late']);
  });

  it('skips the recoverable-failed query when no provider is configured', async () => {
    const { reconciler, db } = build({ providers: [] });

    await reconciler.runOnce();

    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

describe('PaymentReconciler.runOnce — late-payment tail cadence', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    expireMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-asks about attempts we gave up on only once per interval, not on every pass', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    let now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { reconciler, db } = build({
      recoverable: [attempt('late', 10 * MINUTE)],
    });

    // First pass: the tail is due, so the recoverable query runs (4 selects).
    expect((await reconciler.runOnce()).checked).toBe(1);
    expect(db.select).toHaveBeenCalledTimes(4);

    // A minute later: not due, so the recoverable query is skipped (3 selects).
    db.select
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]));
    now += MINUTE;
    expect((await reconciler.runOnce()).checked).toBe(0);
    expect(db.select).toHaveBeenCalledTimes(7);

    // Five minutes after the first look: due again.
    db.select
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([attempt('late', 15 * MINUTE)]));
    now += 4 * MINUTE;
    expect((await reconciler.runOnce()).checked).toBe(1);
    expect(db.select).toHaveBeenCalledTimes(11);
  });

  it('still checks pending attempts on every pass while the tail waits', async () => {
    reconcileMock.mockResolvedValue('still_pending');
    let now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { reconciler, db } = build({});

    await reconciler.runOnce();
    db.select
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([attempt('live', 20_000)]));
    now += 10_000;

    expect((await reconciler.runOnce()).checked).toBe(1);
  });
});

describe('PaymentReconciler.runOnce — webhook-only expiry', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    expireMock.mockReset();
  });

  it('fails each expired attempt and counts it as abandoned, with no provider call', async () => {
    expireMock.mockResolvedValue('expired');
    const { reconciler } = build({ expired: [{ id: 'e1' }, { id: 'e2' }] });

    const summary = await reconciler.runOnce();

    expect(expireMock).toHaveBeenCalledTimes(2);
    expect(expireMock).toHaveBeenCalledWith(expect.anything(), 'e1');
    expect(expireMock).toHaveBeenCalledWith(expect.anything(), 'e2');
    expect(summary.abandoned).toBe(2);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('does not count an attempt a webhook settled first (skipped)', async () => {
    expireMock.mockResolvedValue('skipped');
    const { reconciler } = build({ expired: [{ id: 'e1' }] });

    expect((await reconciler.runOnce()).abandoned).toBe(0);
  });

  it('keeps going after one attempt fails to expire', async () => {
    expireMock.mockResolvedValueOnce('error').mockResolvedValueOnce('expired');
    const { reconciler } = build({ expired: [{ id: 'e1' }, { id: 'e2' }] });

    expect((await reconciler.runOnce()).abandoned).toBe(1);
    expect(expireMock).toHaveBeenCalledTimes(2);
  });

  it('expires even when no provider is configured to poll', async () => {
    expireMock.mockResolvedValue('expired');
    const { reconciler } = build({ expired: [{ id: 'e1' }], providers: [] });

    const summary = await reconciler.runOnce();

    expect(summary.abandoned).toBe(1);
    expect(summary.checked).toBe(0);
  });
});

describe('PaymentReconciler timer', () => {
  const BASE = 15_000;
  const IDLE = 60_000;
  const FAST = 5_000;

  beforeEach(() => {
    reconcileMock.mockReset();
    expireMock.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * `candidatesFor(tickIndex)` supplies the pending-attempt rows for each
   * pass. Ticks are counted by wrapping `runOnce`, so a pass that skips the
   * recoverable query (fewer selects) is still exactly one tick. `gate` holds
   * the first pass open until released, to simulate `arm()` arriving mid-pass.
   */
  function buildLoop(
    candidatesFor: (tick: number) => unknown[],
    opts: { gate?: Promise<void>; reconcilerEnabled?: boolean } = {},
  ) {
    let tickIndex = -1;
    let position = 0;
    const select = jest.fn(() => {
      const at = position;
      position += 1;
      const rows = at === 2 ? candidatesFor(tickIndex) : [];
      const query = chain(rows);
      if (at === 0 && tickIndex === 0 && opts.gate) {
        const gate = opts.gate;
        query.limit = jest.fn(() => gate.then(() => []));
      }
      return query;
    });
    const reconciler = new PaymentReconciler(
      { select } as never,
      {} as never,
      { wakeupAfterCommit: jest.fn() } as never,
      { activatePaidPurchase: jest.fn() } as never,
      {
        get: jest.fn((key: string) => {
          if (key === 'payment.reconcilerEnabled')
            return opts.reconcilerEnabled;
          if (key === 'payment.reconcileProviders') return ['bakong'];
          if (key === 'payment.reconcileIntervalMs') return BASE;
          if (key === 'payment.reconcileIdleIntervalMs') return IDLE;
          return undefined;
        }),
      } as never,
    );
    const original = reconciler.runOnce.bind(
      reconciler,
    ) as () => Promise<ReconcileSummary>;
    jest.spyOn(reconciler, 'runOnce').mockImplementation(() => {
      tickIndex += 1;
      position = 0;
      return original();
    });
    const ticks = () => tickIndex + 1;
    return { reconciler, ticks };
  }

  it('still runs a tick immediately at boot', async () => {
    const { reconciler, ticks } = buildLoop(() => []);

    reconciler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    expect(ticks()).toBe(1);
    reconciler.onModuleDestroy();
  });

  it('stretches to the idle interval while nothing is pending', async () => {
    const { reconciler, ticks } = buildLoop(() => []);

    reconciler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BASE * 3);
    expect(ticks()).toBe(1);

    await jest.advanceTimersByTimeAsync(IDLE);
    expect(ticks()).toBe(2);
    reconciler.onModuleDestroy();
  });

  it('polls tightly while a freshly issued checkout is still unpaid', async () => {
    const { reconciler, ticks } = buildLoop(() => [attempt('a1', 10_000)]);
    reconcileMock.mockResolvedValue('still_pending');

    reconciler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(FAST * 3);

    // Boot tick, then one every FAST ms.
    expect(ticks()).toBe(4);
    reconciler.onModuleDestroy();
  });

  it('relaxes to the base interval once the pending checkout is past the fast window', async () => {
    const { reconciler, ticks } = buildLoop(() => [attempt('a1', MINUTE)]);
    reconcileMock.mockResolvedValue('still_pending');

    reconciler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BASE * 4);

    expect(ticks()).toBe(5);
    reconciler.onModuleDestroy();
  });

  it('returns to the base interval once an attempt shows up, and relaxes again after', async () => {
    // Tick 0 idle, tick 1 sees an attempt, tick 2 sees none.
    const { reconciler, ticks } = buildLoop((tick) =>
      tick === 1 ? [attempt('a1', MINUTE)] : [],
    );
    reconcileMock.mockResolvedValue('still_pending');

    reconciler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(IDLE); // tick 1 (found an attempt)
    expect(ticks()).toBe(2);

    await jest.advanceTimersByTimeAsync(BASE); // tick 2 (empty again)
    expect(ticks()).toBe(3);

    await jest.advanceTimersByTimeAsync(BASE * 3);
    expect(ticks()).toBe(3); // idle again: no tick inside the base window
    reconciler.onModuleDestroy();
  });

  it('stops ticking after shutdown', async () => {
    const { reconciler, ticks } = buildLoop(() => []);

    reconciler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    reconciler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(IDLE * 5);

    expect(ticks()).toBe(1);
  });

  describe('arm() — a checkout was just issued', () => {
    it('wakes a reconciler that is sleeping out the idle interval', async () => {
      const { reconciler, ticks } = buildLoop(() => []);
      reconciler.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(ticks()).toBe(1);

      reconciler.arm();
      await jest.advanceTimersByTimeAsync(FAST - 1);
      expect(ticks()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      expect(ticks()).toBe(2);
      reconciler.onModuleDestroy();
    });

    it('is triggered by the payment.issued handler', async () => {
      const { reconciler, ticks } = buildLoop(() => []);
      reconciler.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(1_000);

      reconciler.handlePaymentIssued();
      await jest.advanceTimersByTimeAsync(FAST);

      expect(ticks()).toBe(2);
      reconciler.onModuleDestroy();
    });

    it('never pushes a sooner tick later', async () => {
      const { reconciler, ticks } = buildLoop(() => [attempt('a1', 10_000)]);
      reconcileMock.mockResolvedValue('still_pending');
      reconciler.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(3_000); // next tick due at 5 s

      reconciler.arm();
      await jest.advanceTimersByTimeAsync(2_000);

      expect(ticks()).toBe(2); // still fired at 5 s, not 8 s
      reconciler.onModuleDestroy();
    });

    it('asks a pass that is already running to come back quickly', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { reconciler, ticks } = buildLoop(() => [], { gate });
      reconciler.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
      expect(ticks()).toBe(1); // held open on its first query

      reconciler.arm(); // that pass's scan may predate the new attempt
      release();
      await jest.advanceTimersByTimeAsync(FAST - 1);
      expect(ticks()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      expect(ticks()).toBe(2); // idle would have been 60 s
      reconciler.onModuleDestroy();
    });

    it('does nothing before the reconciler has started', async () => {
      const { reconciler, ticks } = buildLoop(() => []);

      reconciler.arm();
      await jest.advanceTimersByTimeAsync(IDLE * 2);

      expect(ticks()).toBe(0);
    });

    it('does nothing when the reconciler is disabled by configuration', async () => {
      const { reconciler, ticks } = buildLoop(() => [], {
        reconcilerEnabled: false,
      });
      reconciler.onApplicationBootstrap();

      reconciler.arm();
      await jest.advanceTimersByTimeAsync(IDLE * 2);

      expect(ticks()).toBe(0);
    });

    it('does nothing after shutdown', async () => {
      const { reconciler, ticks } = buildLoop(() => []);
      reconciler.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
      reconciler.onModuleDestroy();

      reconciler.arm();
      await jest.advanceTimersByTimeAsync(IDLE * 2);

      expect(ticks()).toBe(1);
    });
  });
});
