import {
  bucketOf,
  groupBucket,
  partitionByAllowance,
  scopeCapOf,
} from './allowance';
import type { AllowanceConfig, HeldGroup } from './allowance';
import { DEFAULT_FREE_PLAN } from './entitlements.constants';

// cars-and-vehicles: cars-for-sale (capped 2), parts (no cap) — in group "auto"
// foods: meat — category capped 50 (above the 5 total, so it never binds)
// pets: dogs — no cap, no group
const config: AllowanceConfig = {
  free: { ...DEFAULT_FREE_PLAN },
  subcategoryGroup: new Map([
    ['cars', 'auto'],
    ['parts', 'auto'],
    ['meat', 'food'],
  ]),
  subcategoryCaps: new Map([['cars', 2]]),
  categoryCaps: new Map([['foods', 50]]),
};

const cars = { categoryId: 'vehicles', subcategoryId: 'cars' };
const parts = { categoryId: 'vehicles', subcategoryId: 'parts' };
const meat = { categoryId: 'foods', subcategoryId: 'meat' };
const dogs = { categoryId: 'pets', subcategoryId: 'dogs' };

const auto: HeldGroup = {
  groupId: 'auto',
  limits: { photos: 24, ads: 30, renews: 10, autoRenews: 20, videos: 10 },
  expiresAt: new Date(Date.now() + 86_400_000),
};
const holding = (...groups: HeldGroup[]) =>
  new Map(groups.map((g) => [g.groupId, g]));

describe('bucketOf', () => {
  it('puts every free ad in one account-wide pool', () => {
    expect(bucketOf(cars, config, holding())).toMatchObject({
      key: 'free',
      kind: 'free',
    });
    expect(bucketOf(cars, config, holding()).limits).toMatchObject({
      ads: 5,
      photos: 8,
      renews: 5,
    });
    expect(bucketOf(dogs, config, holding()).key).toBe('free');
    expect(bucketOf(parts, config, holding()).key).toBe('free');
  });

  it('puts every subcategory of a held group in one shared pool', () => {
    const held = holding(auto);
    expect(bucketOf(cars, config, held).key).toBe('group:auto');
    expect(bucketOf(parts, config, held).key).toBe('group:auto');
    expect(bucketOf(cars, config, held).limits).toEqual(auto.limits);
  });

  it('leaves other groups on the free plan', () => {
    expect(bucketOf(meat, config, holding(auto)).key).toBe('free');
  });

  it('never gives a subscriber fewer photos or renews than free', () => {
    const stingy: HeldGroup = {
      ...auto,
      limits: { photos: 1, ads: 30, renews: 0, autoRenews: 0, videos: 0 },
    };
    const { limits } = bucketOf(cars, config, holding(stingy));
    expect(limits.photos).toBe(8);
    expect(limits.renews).toBe(5);
    expect(limits.ads).toBe(30);
  });
});

describe('scopeCapOf', () => {
  it('prefers a subcategory cap over its category cap', () => {
    expect(scopeCapOf(cars, config)).toEqual({ key: 'sub:cars', ads: 2 });
  });

  it('falls back to the category cap', () => {
    expect(scopeCapOf(meat, config)).toEqual({ key: 'cat:foods', ads: 50 });
  });

  it('returns nothing for an uncapped category', () => {
    expect(scopeCapOf(dogs, config)).toBeUndefined();
  });
});

describe('groupBucket', () => {
  it('builds a held group bucket without an ad scope', () => {
    expect(groupBucket('auto', config, holding(auto))).toMatchObject({
      key: 'group:auto',
      groupId: 'auto',
      limits: auto.limits,
    });
  });

  it('returns undefined for a group the user does not hold', () => {
    expect(groupBucket('auto', config, holding())).toBeUndefined();
  });
});

describe('partitionByAllowance', () => {
  const ad = (id: string, scope: typeof cars) => ({
    id,
    status: 'active',
    ...scope,
  });

  it('keeps the newest 5 free ads and enforces the scope cap inside them', () => {
    const live = [
      ad('c1', cars),
      ad('c2', cars),
      ad('c3', cars), // over the car cap; does not consume a pool slot
      ad('d1', dogs),
      ad('d2', dogs),
      ad('d3', dogs),
      ad('d4', dogs), // the free pool is full
    ];
    const { within, beyond } = partitionByAllowance(live, config, holding());
    expect(within.map((a) => a.id)).toEqual(['c1', 'c2', 'd1', 'd2', 'd3']);
    expect(beyond.map((a) => a.id)).toEqual(['c3', 'd4']);
  });

  it('never lets a cap above the total bind', () => {
    const live = Array.from({ length: 7 }, (_, i) => ad(`m${i}`, meat));
    const { within, beyond } = partitionByAllowance(live, config, holding());
    expect(within).toHaveLength(5);
    expect(beyond.map((a) => a.id)).toEqual(['m5', 'm6']);
  });

  it('lifts the free caps once the group is held', () => {
    const live = [
      ad('c1', cars),
      ad('c2', cars),
      ad('c3', cars),
      ad('c4', cars),
    ];
    const { beyond } = partitionByAllowance(live, config, holding(auto));
    expect(beyond).toEqual([]);
  });

  it('does not apply a free scope cap to ads in a held group', () => {
    // The car cap is 2, but all four ads are in the Auto package's pool.
    const live = Array.from({ length: 6 }, (_, i) => ad(`c${i}`, cars));
    const { within } = partitionByAllowance(
      live,
      { ...config, subcategoryCaps: new Map([['cars', 2]]) },
      holding({ ...auto, limits: { ...auto.limits, ads: 4 } }),
    );
    expect(within).toHaveLength(4);
  });
});
