import type { FreePlanSettings, PlanLimits } from './entitlements.constants';

/**
 * Where an ad's allowance comes from. Every ad lands in exactly one pool:
 *
 *   group:<id>  its subcategory is covered by a group the owner holds — the
 *               group's package limits, `ads` shared by all of its subcategories
 *   free        everything else — the free plan's account-wide `otherAds`
 *               allowance, shared by every ad outside a held group
 *
 * Free-plan caps (`free_plan_ad_limits`) are sub-limits INSIDE the free pool:
 * they cap how many of the account's free ads may sit in one scope (a
 * subcategory, else its whole category). A cap larger than the pool's total
 * never binds, and a subscription covering the scope replaces both.
 */
export type BucketKey = `group:${string}` | 'free';

/** A free-plan cap row's key, used by the public price sheet. */
export type ScopeKey = `sub:${string}` | `cat:${string}`;

export interface AllowanceConfig {
  free: FreePlanSettings;
  /** subcategoryId → subscription category (group) id */
  subcategoryGroup: ReadonlyMap<string, string>;
  /** subcategoryId → free ad cap */
  subcategoryCaps: ReadonlyMap<string, number>;
  /** categoryId → free ad cap */
  categoryCaps: ReadonlyMap<string, number>;
}

export interface HeldGroup {
  groupId: string;
  limits: PlanLimits;
  expiresAt: Date;
}

export interface Bucket {
  key: BucketKey;
  kind: 'group' | 'free';
  groupId: string | null;
  limits: PlanLimits;
}

export interface AdScope {
  categoryId: string;
  subcategoryId: string;
}

/** The free-plan cap that applies to one ad's scope, if any. */
export interface ScopeCap {
  key: ScopeKey;
  ads: number;
}

export function freeLimits(free: FreePlanSettings, ads: number): PlanLimits {
  return {
    photos: free.photos,
    ads,
    renews: free.renews,
    autoRenews: free.autoRenews,
    videos: free.videos,
  };
}

export function groupBucket(
  groupId: string,
  config: AllowanceConfig,
  held: ReadonlyMap<string, HeldGroup>,
): Bucket | undefined {
  const group = held.get(groupId);
  if (!group) return undefined;
  const { free } = config;
  return {
    key: `group:${group.groupId}`,
    kind: 'group',
    groupId: group.groupId,
    // A subscriber is never worse off per ad than the free plan; the ad
    // pool is the package's own number, since it replaces the free caps.
    limits: {
      photos: Math.max(free.photos, group.limits.photos),
      ads: group.limits.ads,
      renews: Math.max(free.renews, group.limits.renews),
      autoRenews: Math.max(free.autoRenews, group.limits.autoRenews),
      videos: Math.max(free.videos, group.limits.videos),
    },
  };
}

/** A subcategory cap beats its category's cap; anything uncapped has none. */
export function scopeCapOf(
  ad: AdScope,
  config: AllowanceConfig,
): ScopeCap | undefined {
  const subCap = config.subcategoryCaps.get(ad.subcategoryId);
  if (subCap !== undefined) {
    return { key: `sub:${ad.subcategoryId}`, ads: subCap };
  }
  const catCap = config.categoryCaps.get(ad.categoryId);
  if (catCap !== undefined) {
    return { key: `cat:${ad.categoryId}`, ads: catCap };
  }
  return undefined;
}

export function bucketOf(
  ad: AdScope,
  config: AllowanceConfig,
  held: ReadonlyMap<string, HeldGroup>,
): Bucket {
  const groupId = config.subcategoryGroup.get(ad.subcategoryId);
  const group = groupId ? groupBucket(groupId, config, held) : undefined;
  if (group) return group;
  return {
    key: 'free',
    kind: 'free',
    groupId: null,
    limits: freeLimits(config.free, config.free.otherAds),
  };
}

export interface LiveAd extends AdScope {
  id: string;
  status: string;
}

/**
 * Splits a user's live ads (newest first) into the ones that fit their
 * allowance and the ones beyond it. The free pool enforces two constraints:
 * the account-wide total, then the ad's scope cap (a no-op for held groups).
 * Ads beyond a scope cap do not consume a pool slot, so one over-cap category
 * cannot push the user's other ads out. Pure — the caller writes.
 */
export function partitionByAllowance<T extends LiveAd>(
  liveNewestFirst: readonly T[],
  config: AllowanceConfig,
  held: ReadonlyMap<string, HeldGroup>,
): { within: T[]; beyond: T[] } {
  const poolUsed = new Map<BucketKey, number>();
  const scopeUsed = new Map<ScopeKey, number>();
  const within: T[] = [];
  const beyond: T[] = [];
  for (const ad of liveNewestFirst) {
    const bucket = bucketOf(ad, config, held);
    const poolCount = poolUsed.get(bucket.key) ?? 0;
    let fits = poolCount < bucket.limits.ads;
    const cap = bucket.kind === 'free' ? scopeCapOf(ad, config) : undefined;
    if (fits && cap) {
      const scopeCount = scopeUsed.get(cap.key) ?? 0;
      fits = scopeCount < Math.min(cap.ads, bucket.limits.ads);
      if (fits) scopeUsed.set(cap.key, scopeCount + 1);
    }
    if (fits) {
      within.push(ad);
      poolUsed.set(bucket.key, poolCount + 1);
    } else {
      beyond.push(ad);
    }
  }
  return { within, beyond };
}
