import { PgDialect } from 'drizzle-orm/pg-core';
import { EntitlementsService } from './entitlements.service';
import { DEFAULT_FREE_PLAN } from './entitlements.constants';

// A drizzle-style query builder: every call chains, awaiting resolves `rows`.
function query(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const method of [
    'from',
    'leftJoin',
    'innerJoin',
    'where',
    'orderBy',
    'groupBy',
    'having',
    'limit',
  ]) {
    q[method] = jest.fn(() => q);
  }
  q.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  return q;
}

interface Setup {
  settings?: unknown[];
  scopes?: { subcategoryId: string; groupId: string }[];
  caps?: {
    categoryId: string | null;
    subcategoryId: string | null;
    ads: number;
  }[];
  held?: unknown[];
  /** The 5th select: live ads, or renewal rows (same field names differ). */
  live?: unknown[];
}

/**
 * Selects are issued in a fixed order: free settings, group scopes, free caps,
 * held subscriptions, then the call's own rows (live ads or renewal rows).
 */
function makeService(setup: Setup, withLive = false) {
  const select = jest.fn();
  const batches = [
    setup.settings ?? [],
    setup.scopes ?? [],
    setup.caps ?? [],
    setup.held ?? [],
    ...(withLive ? [setup.live ?? []] : []),
  ];
  for (const rows of batches) select.mockReturnValueOnce(query(rows));
  const returning = jest.fn().mockResolvedValue([]);
  const where = jest.fn<{ returning: typeof returning }, [unknown?]>(() => ({
    returning,
  }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const service = new EntitlementsService({ select, update } as never);
  return { service, update, set, where, returning, select };
}

/** Explicit select batches, for `view()` whose read order is longer. */
function makeServiceWith(batches: unknown[][]) {
  const select = jest.fn();
  for (const rows of batches) select.mockReturnValueOnce(query(rows));
  return new EntitlementsService({ select } as never);
}

const future = new Date(Date.now() + 10 * 24 * 3600 * 1000);
const cars = { categoryId: 'vehicles', subcategoryId: 'cars' };
const dogs = { categoryId: 'pets', subcategoryId: 'dogs' };
const scopes = [{ subcategoryId: 'cars', groupId: 'auto' }];
const caps = [{ categoryId: null, subcategoryId: 'cars', ads: 2 }];
const autoSub = {
  groupId: 'auto',
  expiresAt: future,
  offerSnapshot: { photos: 20, ads: 50, renews: 4 },
  photos: 1,
  ads: 1,
  renews: 1,
  autoRenews: 0,
  videos: 2,
};
const settings = [
  { photos: 8, renews: 5, autoRenews: 0, videos: 0, otherAds: 5 },
];

describe('EntitlementsService.resolve', () => {
  it('gives the free plan defaults when nothing is configured or held', async () => {
    const { service } = makeService({});
    const result = await service.resolve('u1', cars);
    expect(result.plan).toBe('free');
    expect(result.bucket.key).toBe('free');
    expect(result.limits).toEqual({
      photos: DEFAULT_FREE_PLAN.photos,
      ads: DEFAULT_FREE_PLAN.otherAds,
      renews: DEFAULT_FREE_PLAN.renews,
      autoRenews: 0,
      videos: 0,
    });
  });

  it('keeps a capped category inside the same free pool', async () => {
    const { service } = makeService({
      settings: [
        { photos: 3, renews: 1, autoRenews: 0, videos: 0, otherAds: 9 },
      ],
      caps,
    });
    const result = await service.resolve('u1', cars);
    expect(result.bucket.key).toBe('free');
    expect(result.limits.ads).toBe(9);
    expect(result.limits.photos).toBe(3);
  });

  it("applies a held group's frozen snapshot to ads in its scope", async () => {
    const { service } = makeService({ scopes, caps, held: [autoSub] });
    const result = await service.resolve('u1', cars);
    expect(result.plan).toBe('premium');
    expect(result.bucket.key).toBe('group:auto');
    expect(result.limits).toMatchObject({ ads: 50, photos: 20, renews: 5 });
    expect(result.expiresAt).toEqual(future);
  });

  it('keeps ads outside the held group on the free plan', async () => {
    const { service } = makeService({ scopes, caps, held: [autoSub] });
    const result = await service.resolve('u1', dogs);
    expect(result.bucket.key).toBe('free');
    expect(result.limits.ads).toBe(DEFAULT_FREE_PLAN.otherAds);
    expect(result.expiresAt).toBeNull();
  });
});

describe('EntitlementsService limit checks', () => {
  it('rejects more photos than the plan allows', async () => {
    const { service } = makeService({});
    await expect(
      service.assertPhotos('u1', cars, DEFAULT_FREE_PLAN.photos + 1),
    ).rejects.toMatchObject({ response: { code: 'PLAN_LIMIT_PHOTOS' } });
  });

  it('grandfathers photos an ad already carries', async () => {
    const { service } = makeService({});
    await expect(
      service.assertPhotos('u1', cars, 12, 12),
    ).resolves.toBeUndefined();
  });

  it('blocks a new ad once the free pool is full', async () => {
    const live = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`,
      status: 'active',
      ...dogs,
    }));
    const { service } = makeService({ live }, true);
    await expect(
      service.assertCanHoldAnotherAd('u1', { id: 'new', ...dogs }),
    ).rejects.toMatchObject({ response: { code: 'PLAN_LIMIT_ADS' } });
  });

  it('blocks a new ad once its scope cap is reached, even with pool room', async () => {
    const live = [
      { id: 'a', status: 'active', ...cars },
      { id: 'b', status: 'active', ...cars },
    ];
    const { service } = makeService({ caps, live }, true);
    await expect(
      service.assertCanHoldAnotherAd('u1', { id: 'new', ...cars }),
    ).rejects.toMatchObject({ response: { code: 'PLAN_LIMIT_ADS' } });
  });

  it('lets a capped category post while both pool and cap have room', async () => {
    const live = [{ id: 'a', status: 'active', ...cars }];
    const { service } = makeService({ caps, live }, true);
    await expect(
      service.assertCanHoldAnotherAd('u1', { id: 'new', ...cars }),
    ).resolves.toBeUndefined();
  });

  it('does not count the ad being re-published against itself', async () => {
    const live = [
      { id: 'a', status: 'active', ...cars },
      { id: 'b', status: 'active', ...cars },
    ];
    const { service } = makeService({ caps, live }, true);
    await expect(
      service.assertCanHoldAnotherAd('u1', { id: 'b', ...cars }),
    ).resolves.toBeUndefined();
  });

  it('blocks renewals once the pool has spent its window', async () => {
    // One row per renewal spent in the last 30 days; five fill the free pool.
    const rows = Array.from({ length: 5 }, (_, i) => ({
      categoryId: 'pets',
      subcategoryId: 'dogs',
      id: `r${i}`,
    }));
    const { service } = makeService({ live: rows }, true);
    await expect(service.assertCanRenew('u1', cars)).rejects.toMatchObject({
      response: { code: 'PLAN_LIMIT_RENEWS' },
    });
  });

  it('counts renewals per pool, not across the account', async () => {
    const rows = [
      { categoryId: 'vehicles', subcategoryId: 'cars' },
      ...Array.from({ length: 5 }, (_, i) => ({
        categoryId: 'pets',
        subcategoryId: 'dogs',
        id: `r${i}`,
      })),
    ];
    // Cars sit in the held Auto pool; the dogs' spend is the free pool's.
    const { service } = makeService(
      { scopes, caps, held: [autoSub], live: rows },
      true,
    );
    await expect(service.assertCanRenew('u1', cars)).resolves.toBeUndefined();
  });
});

describe('EntitlementsService.view', () => {
  it('sums the free total and every held group for the Manage Ads header', async () => {
    const live = [
      { id: 'a', status: 'active', ...dogs },
      { id: 'b', status: 'restricted', ...dogs },
    ];
    const service = makeServiceWith([
      settings,
      scopes,
      caps,
      [autoSub],
      live,
      [{ total: 2 }],
      [{ id: 'auto', name: 'Auto' }],
    ]);
    const view = await service.view('u1');
    expect(view.plan).toBe('premium');
    expect(view.limits.ads).toBe(5 + 50);
    expect(view.limits.renews).toBe(5 + 5);
    expect(view.usage).toEqual({ ads: 2, renews: 2, hidden: 1 });
    expect(view.bucket).toBeNull();
    expect(view.buckets.map((b) => b.key).sort()).toEqual([
      'free',
      'group:auto',
    ]);
  });

  it('clamps a scope view to the smaller of its cap and the free total', async () => {
    const live = [
      { id: 'a', status: 'active', ...cars },
      { id: 'b', status: 'active', ...cars },
    ];
    const service = makeServiceWith([
      settings,
      [],
      caps,
      [],
      live,
      [{ categoryId: 'vehicles' }],
      [{ total: 0 }],
      // bucketNames for the pool keys hit no table; the scope name does.
      [{ id: 'cars', slug: 'cars-for-sale', name: 'Cars For Sale' }],
    ]);
    const view = await service.view('u1', 'cars');
    expect(view.bucket).toMatchObject({ key: 'free', name: 'Cars For Sale' });
    expect(view.bucket?.limits.ads).toBe(2);
    expect(view.usage.ads).toBe(2);
  });

  it("reports a held group's package as the scope limit", async () => {
    const live = [{ id: 'a', status: 'active', ...cars }];
    const service = makeServiceWith([
      settings,
      scopes,
      caps,
      [autoSub],
      live,
      [{ categoryId: 'vehicles' }],
      [{ total: 1 }],
      [{ id: 'auto', name: 'Auto' }],
    ]);
    const view = await service.view('u1', 'cars');
    expect(view.bucket).toMatchObject({ key: 'group:auto', name: 'Auto' });
    expect(view.bucket?.limits.ads).toBe(50);
  });
});

describe('EntitlementsService.reconcileListings', () => {
  it('restricts the oldest ads beyond their scope cap and restores none', async () => {
    // newest → oldest; cars-for-sale keeps the first 2
    const live = ['a', 'b', 'c'].map((id) => ({
      id,
      status: 'active',
      ...cars,
    }));
    const { service, update, set, returning } = makeService(
      { caps, live },
      true,
    );
    returning.mockResolvedValueOnce([{ id: 'c' }]);
    const result = await service.reconcileListings('u1');
    expect(result).toEqual({ restricted: 1, restored: 0 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'restricted' }),
    );
  });

  it('restores restricted ads once a held group covers them', async () => {
    const live = [
      { id: 'a', status: 'active', ...cars },
      { id: 'b', status: 'active', ...cars },
      { id: 'c', status: 'restricted', ...cars },
    ];
    const { service, set, returning } = makeService(
      { scopes, caps, held: [autoSub], live },
      true,
    );
    returning.mockResolvedValueOnce([{ id: 'c' }]);
    const result = await service.reconcileListings('u1');
    expect(result).toEqual({ restricted: 0, restored: 1 });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('guards both writes by owner and expected status and counts only returned rows', async () => {
    const live = [
      { id: 'a', status: 'active', ...cars },
      { id: 'b', status: 'restricted', ...cars },
      { id: 'c', status: 'active', ...cars },
    ];
    const { service, where, returning } = makeService({ caps, live }, true);
    // Simulate both rows changing status after the read; guarded UPDATEs match none.
    returning.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(service.reconcileListings('u1')).resolves.toEqual({
      restricted: 0,
      restored: 0,
    });

    expect(where).toHaveBeenCalledTimes(2);
    const dialect = new PgDialect();
    const clauses = where.mock.calls.map(([condition]) =>
      dialect.sqlToQuery(condition as never),
    );
    expect(clauses[0].sql).toContain('"status" =');
    expect(clauses[0].params).toContain('restricted');
    expect(clauses[0].params).toContain('u1');
    expect(clauses[1].sql).toContain('"status" =');
    expect(clauses[1].params).toContain('active');
    expect(clauses[1].params).toContain('u1');
  });

  it('does nothing when the ads already match the allowance', async () => {
    const live = [{ id: 'a', status: 'active', ...cars }];
    const { service, update } = makeService({ caps, live }, true);
    await service.reconcileListings('u1');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('EntitlementsService.freePlan', () => {
  it('lists every cap by name in catalog order', async () => {
    const select = jest.fn();
    const rows = [
      [{ photos: 8, renews: 5, autoRenews: 0, videos: 0, otherAds: 5 }],
      [],
      [
        { categoryId: null, subcategoryId: 'rent', ads: 2 },
        { categoryId: null, subcategoryId: 'cars', ads: 2 },
        { categoryId: 'foods', subcategoryId: null, ads: 50 },
      ],
      // subcategory sort orders, category sort orders
      [
        { id: 'rent', sub: 3, cat: 0 },
        { id: 'cars', sub: 0, cat: 0 },
      ],
      [{ id: 'foods', cat: 11 }],
      // names: groups (none), subcategories, categories
      [
        { id: 'cars', slug: 'cars-for-sale', name: 'Cars For Sale' },
        { id: 'rent', slug: 'vehicles-for-rent', name: null },
      ],
      [{ id: 'foods', name: 'Foods' }],
    ];
    for (const r of rows) select.mockReturnValueOnce(query(r));
    const service = new EntitlementsService({ select } as never);

    const plan = await service.freePlan();
    expect(plan).toMatchObject({ photos: 8, renews: 5, otherAds: 5 });
    expect(plan.caps).toEqual([
      { key: 'sub:cars', name: 'Cars For Sale', ads: 2 },
      { key: 'sub:rent', name: 'vehicles-for-rent', ads: 2 },
      { key: 'cat:foods', name: 'Foods', ads: 50 },
    ]);
  });
});
