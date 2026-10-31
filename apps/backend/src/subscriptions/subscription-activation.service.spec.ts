import {
  planActivation,
  SubscriptionActivationService,
} from './subscription-activation.service';
import {
  subscriptionStatus,
  type SubscriptionStatus,
} from './subscription-status';

function makePurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'purchase-1',
    userId: 'user-1',
    termId: 'term-1',
    paymentTransactionId: 'payment-1',
    status: 'pending',
    amountUsd: '10.00',
    currency: 'USD',
    offerSnapshot: {
      durationValue: 1,
      durationUnit: 'month',
      subscriptionCategoryId: 'group-1',
    },
    ...overrides,
  };
}

function makePurchaseQuery(purchase: ReturnType<typeof makePurchase>) {
  return {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    for: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([purchase]),
  };
}

describe('SubscriptionActivationService', () => {
  it.each([
    ['transaction ID', { paymentTransactionId: 'another-payment' }],
    ['customer', { customerId: 'another-user' }],
    ['amount', { amount: '0.01' }],
    ['currency', { currency: 'KHR' }],
  ])(
    'does not grant subscription for mismatched %s',
    async (_field, changed) => {
      const purchase = makePurchase();
      const purchaseQuery = makePurchaseQuery(purchase);
      const tx = {
        select: jest.fn().mockReturnValue(purchaseQuery),
        insert: jest.fn(),
        update: jest.fn(),
      };
      const db = {
        transaction: jest.fn((callback: (executor: unknown) => unknown) =>
          callback(tx),
        ),
      };
      const service = new SubscriptionActivationService(
        db as never,
        { reconcileListingsSafely: jest.fn() } as never,
      );

      const result = await service.activatePaidPurchase({
        purchaseId: purchase.id,
        paymentTransactionId: 'payment-1',
        customerId: 'user-1',
        amount: '10.00',
        currency: 'USD',
        ...changed,
      });

      expect(result).toEqual({ status: 'payment_mismatch' });
      expect(purchaseQuery.for).toHaveBeenCalledWith('update');
      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    },
  );

  it('does not create a second entitlement when purchase already paid', async () => {
    const purchase = makePurchase({ status: 'paid' });
    const tx = {
      select: jest.fn().mockReturnValue(makePurchaseQuery(purchase)),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const db = {
      transaction: jest.fn((callback: (executor: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SubscriptionActivationService(
      db as never,
      { reconcileListingsSafely: jest.fn() } as never,
    );

    const result = await service.activatePaidPurchase({
      purchaseId: purchase.id,
      paymentTransactionId: 'payment-1',
      customerId: 'user-1',
      amount: '10.00',
      currency: 'USD',
    });

    expect(result).toEqual({ status: 'already_paid' });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('retries settlement until checkout links the payment transaction', async () => {
    const purchase = makePurchase({ paymentTransactionId: null });
    const tx = {
      select: jest.fn().mockReturnValue(makePurchaseQuery(purchase)),
      insert: jest.fn(),
      update: jest.fn(),
    };
    const db = {
      transaction: jest.fn((callback: (executor: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SubscriptionActivationService(
      db as never,
      { reconcileListingsSafely: jest.fn() } as never,
    );

    const result = await service.activatePaidPurchase({
      purchaseId: purchase.id,
      paymentTransactionId: 'payment-1',
      customerId: 'user-1',
      amount: '10.00',
      currency: 'USD',
    });

    expect(result).toEqual({ status: 'payment_link_pending' });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('activates a purchase only after its linked payment settles', async () => {
    const purchase = makePurchase();
    const purchaseQuery = makePurchaseQuery(purchase);
    const userLockQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      for: jest.fn().mockResolvedValue([{ id: purchase.userId }]),
    };
    const currentSubscriptionsQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(purchaseQuery)
        .mockReturnValueOnce(userLockQuery)
        .mockReturnValueOnce(currentSubscriptionsQuery),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'subscription-1' }]),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const db = {
      transaction: jest.fn((callback: (executor: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SubscriptionActivationService(
      db as never,
      { reconcileListingsSafely: jest.fn() } as never,
    );

    const result = await service.activatePaidPurchase({
      purchaseId: purchase.id,
      paymentTransactionId: 'payment-1',
      customerId: 'user-1',
      amount: '10.00',
      currency: 'USD',
    });

    expect(result).toEqual({
      status: 'activated',
      subscriptionId: 'subscription-1',
    });
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['paid upgrade keeps the current expiry', 'upgrade', true],
    ['manual comp starts a fresh full term', 'manual_comp', false],
  ])('%s', async (_name, kind, keepsExpiry) => {
    const purchase = makePurchase({ kind, replacesSubscriptionId: 'old-sub' });
    const activeExpiry = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const insertValues = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: 'subscription-2' }]),
    });
    const chain = (rows: unknown) => ({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      for: jest.fn().mockResolvedValue(rows),
      limit: jest.fn().mockResolvedValue(rows),
    });
    const currentRows = (rows: unknown) => ({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(rows),
    });
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePurchaseQuery(purchase))
        .mockReturnValueOnce(chain([{ id: purchase.userId }]))
        .mockReturnValueOnce(
          currentRows([{ id: 'old-sub', expiresAt: activeExpiry }]),
        ),
      insert: jest.fn().mockReturnValue({ values: insertValues }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const db = {
      transaction: jest.fn((callback: (executor: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SubscriptionActivationService(
      db as never,
      { reconcileListingsSafely: jest.fn() } as never,
    );

    const settlement = {
      purchaseId: purchase.id,
      paymentTransactionId: 'payment-1',
      customerId: 'user-1',
      amount: '10.00',
      currency: 'USD',
    };
    if (kind === 'manual_comp') {
      await (
        service as unknown as {
          activatePurchaseInTx: (t: unknown, id: string) => Promise<unknown>;
        }
      ).activatePurchaseInTx(tx, purchase.id);
    } else {
      await service.activatePaidPurchase(settlement);
    }

    const inserted = (
      insertValues.mock.calls as [
        { expiresAt: Date; subscriptionCategoryId: string | null },
      ][]
    )[0][0];
    // The new row joins the purchase's group, so only that group is replaced.
    expect(inserted.subscriptionCategoryId).toBe('group-1');
    if (keepsExpiry) {
      expect(inserted.expiresAt).toEqual(activeExpiry);
    } else {
      expect(inserted.expiresAt.getTime()).toBeGreaterThan(
        activeExpiry.getTime(),
      );
    }
  });
});

describe('planActivation', () => {
  const now = new Date('2026-10-19T00:00:00Z');
  const days = (n: number) => new Date(now.getTime() + n * 24 * 3600 * 1000);
  const fullTermEnd = days(365);

  it('supersedes the replaced plan as history and keeps its expiry', () => {
    const plan = planActivation({
      kind: 'upgrade',
      replacesSubscriptionId: 'a',
      fullTermEnd,
      current: [{ id: 'a', expiresAt: days(20) }],
      baseExpiresAt: null,
      now,
    });
    expect(plan).toEqual({
      expiresAt: days(20),
      supersede: [{ id: 'a', reason: 'upgrade' }],
      needsReview: false,
    });
  });

  it('retires an expired current row so a new purchase never adds a second', () => {
    const plan = planActivation({
      kind: 'initial',
      replacesSubscriptionId: null,
      fullTermEnd,
      current: [{ id: 'old', expiresAt: days(-3) }],
      baseExpiresAt: null,
      now,
    });
    expect(plan).toEqual({
      expiresAt: fullTermEnd,
      supersede: [{ id: 'old', reason: 'expired' }],
      needsReview: false,
    });
  });

  it('gives a stale full-price initial a full term and flags the replaced plan', () => {
    const plan = planActivation({
      kind: 'initial',
      replacesSubscriptionId: null,
      fullTermEnd,
      current: [{ id: 'b', expiresAt: days(40) }],
      baseExpiresAt: null,
      now,
    });
    expect(plan).toEqual({
      expiresAt: fullTermEnd,
      supersede: [{ id: 'b', reason: 'replaced' }],
      needsReview: true,
    });
  });

  it('keeps the current boundary for an upgrade quoted against an older plan', () => {
    const plan = planActivation({
      kind: 'upgrade',
      replacesSubscriptionId: 'a',
      fullTermEnd,
      current: [{ id: 'b', expiresAt: days(20) }],
      baseExpiresAt: days(20),
      now,
    });
    expect(plan.expiresAt).toEqual(days(20));
    expect(plan.supersede).toEqual([{ id: 'b', reason: 'upgrade' }]);
    expect(plan.needsReview).toBe(true);
  });

  it('honours a revoked base until its own expiry', () => {
    const plan = planActivation({
      kind: 'upgrade',
      replacesSubscriptionId: 'a',
      fullTermEnd,
      current: [],
      baseExpiresAt: days(10),
      now,
    });
    expect(plan).toEqual({
      expiresAt: days(10),
      supersede: [],
      needsReview: true,
    });
  });

  it('grants nothing when the upgrade base has lapsed', () => {
    const plan = planActivation({
      kind: 'upgrade',
      replacesSubscriptionId: 'a',
      fullTermEnd,
      current: [],
      baseExpiresAt: days(-1),
      now,
    });
    expect(plan).toEqual({ expiresAt: null, supersede: [], needsReview: true });
  });

  it('starts an admin comp on a full term, replacing the current plan', () => {
    const plan = planActivation({
      kind: 'manual_comp',
      replacesSubscriptionId: null,
      fullTermEnd,
      current: [{ id: 'a', expiresAt: days(20) }],
      baseExpiresAt: null,
      now,
    });
    expect(plan).toEqual({
      expiresAt: fullTermEnd,
      supersede: [{ id: 'a', reason: 'replaced' }],
      needsReview: false,
    });
  });
});

describe('subscriptionStatus', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  const future = new Date(now + 1000);
  const past = new Date(now - 1000);

  it.each<[Parameters<typeof subscriptionStatus>[0], SubscriptionStatus]>([
    [
      { expiresAt: future, supersededAt: null, supersededReason: null },
      'active',
    ],
    [
      { expiresAt: past, supersededAt: null, supersededReason: null },
      'expired',
    ],
    [
      { expiresAt: future, supersededAt: past, supersededReason: 'upgrade' },
      'superseded',
    ],
    [
      { expiresAt: future, supersededAt: past, supersededReason: 'replaced' },
      'superseded',
    ],
    [
      { expiresAt: past, supersededAt: past, supersededReason: 'expired' },
      'expired',
    ],
    [
      { expiresAt: future, supersededAt: past, supersededReason: 'revoked' },
      'revoked',
    ],
  ])('%o -> %s', (row, expected) => {
    expect(subscriptionStatus(row, now)).toBe(expected);
  });
});
