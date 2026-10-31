import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.provider';
import type { DbClient } from '../../db/drizzle.provider';
import {
  freePlanAdLimits,
  freePlanSettings,
  subscriptionCategories,
  subscriptionCategorySubcategories,
  subscriptionPackages,
  subscriptionTerms,
} from '../../db/schema/subscriptions.schema';
import { EntitlementsScheduler } from '../../subscriptions/entitlements.scheduler';
import { toFreePlanSettings } from '../../subscriptions/entitlements.constants';
import type {
  SubscriptionCategoryRow,
  SubscriptionPackageRow,
  SubscriptionTermRow,
} from '../../db/schema/subscriptions.schema';
import type {
  CreateSubCategoryDto,
  UpdateSubCategoryDto,
  CreateSubPackageDto,
  UpdateSubPackageDto,
  CreateSubTermDto,
  UpdateSubTermDto,
  UpdateFreePlanDto,
  UpdateSubCategoryScopeDto,
} from './dto/subscription-config.dto';

/** The fixed package tiers, in display order. */
const TIERS = ['bronze', 'silver', 'gold'] as const;
type Tier = (typeof TIERS)[number];

function tierLabel(tier: Tier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** The fixed purchasable durations, in display order. */
const TERM_MONTHS = [3, 6, 12] as const;

function termLabel(months: number): string {
  return months === 12 ? '1 Year' : `${months} Months`;
}

function termRank(months: number): number {
  return (TERM_MONTHS as readonly number[]).indexOf(months);
}

/** Only the fixed 3/6/12-month picker values may be active. */
function isPickerTerm(months: number, unit: string): boolean {
  return (
    unit === 'month' && (TERM_MONTHS as readonly number[]).includes(months)
  );
}

@Injectable()
export class SubscriptionConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly entitlementsScheduler: EntitlementsScheduler,
  ) {}

  // ── Categories ──────────────────────────────────────────
  /** Each group with the listing subcategories it covers. */
  async listCategories() {
    const [rows, scopes] = await Promise.all([
      this.db
        .select()
        .from(subscriptionCategories)
        .orderBy(asc(subscriptionCategories.sortOrder)),
      this.db.select().from(subscriptionCategorySubcategories),
    ]);
    const byGroup = new Map<string, string[]>();
    for (const scope of scopes) {
      const ids = byGroup.get(scope.subscriptionCategoryId) ?? [];
      ids.push(scope.subcategoryId);
      byGroup.set(scope.subscriptionCategoryId, ids);
    }
    return rows.map((row) => ({
      ...row,
      subcategoryIds: byGroup.get(row.id) ?? [],
    }));
  }

  /**
   * Replaces the subcategories a group covers. A subcategory already in
   * another group is refused (409) rather than moved, so one edit can never
   * silently shift another group's subscribers. Affected users' ads are
   * reconciled in the background; the 10-minute sweep is the backstop.
   */
  async updateCategoryScope(id: string, dto: UpdateSubCategoryScopeDto) {
    const subcategoryIds = [...new Set(dto.subcategoryIds)];
    await this.db
      .transaction(async (tx) => {
        const [group] = await tx
          .select({ id: subscriptionCategories.id })
          .from(subscriptionCategories)
          .where(eq(subscriptionCategories.id, id))
          .for('update')
          .limit(1);
        if (!group) throw new NotFoundException('Category not found');

        if (subcategoryIds.length > 0) {
          const taken = await tx
            .select({
              subcategoryId: subscriptionCategorySubcategories.subcategoryId,
              groupName: subscriptionCategories.name,
            })
            .from(subscriptionCategorySubcategories)
            .innerJoin(
              subscriptionCategories,
              eq(
                subscriptionCategories.id,
                subscriptionCategorySubcategories.subscriptionCategoryId,
              ),
            )
            .where(
              and(
                inArray(
                  subscriptionCategorySubcategories.subcategoryId,
                  subcategoryIds,
                ),
                ne(
                  subscriptionCategorySubcategories.subscriptionCategoryId,
                  id,
                ),
              ),
            );
          if (taken.length > 0) {
            throw new ConflictException({
              code: 'SUBCATEGORY_IN_ANOTHER_GROUP',
              message: `${taken.length === 1 ? '1 subcategory is' : `${taken.length} subcategories are`} already covered by ${[...new Set(taken.map((t) => t.groupName))].join(', ')}. Remove ${taken.length === 1 ? 'it' : 'them'} there first.`,
              details: taken,
            });
          }
        }

        await tx
          .delete(subscriptionCategorySubcategories)
          .where(
            eq(subscriptionCategorySubcategories.subscriptionCategoryId, id),
          );
        if (subcategoryIds.length > 0) {
          await tx.insert(subscriptionCategorySubcategories).values(
            subcategoryIds.map((subcategoryId) => ({
              subscriptionCategoryId: id,
              subcategoryId,
            })),
          );
        }
      })
      .catch((err: unknown) => {
        // A concurrent edit of another group claimed one first.
        if ((err as { code?: string } | null)?.code === '23505') {
          throw new ConflictException(
            'A subcategory was just added to another group. Reload and try again.',
          );
        }
        this.rethrow(err);
      });

    await this.entitlementsScheduler.enqueueConfigReconcile();
    return { id, subcategoryIds };
  }

  async createCategory(dto: CreateSubCategoryDto) {
    try {
      const [row] = await this.db
        .insert(subscriptionCategories)
        .values({
          name: dto.name,
          slug: dto.slug,
          description: dto.description ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        })
        .returning();
      return row;
    } catch (err) {
      this.rethrow(err);
    }
  }

  async updateCategory(id: string, dto: UpdateSubCategoryDto) {
    const patch: Partial<SubscriptionCategoryRow> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.slug !== undefined) patch.slug = dto.slug;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    try {
      const rows = Object.keys(patch).length
        ? await this.db
            .update(subscriptionCategories)
            .set(patch)
            .where(eq(subscriptionCategories.id, id))
            .returning()
        : await this.db
            .select()
            .from(subscriptionCategories)
            .where(eq(subscriptionCategories.id, id));
      if (!rows.length) throw new NotFoundException('Category not found');
      return rows[0];
    } catch (err) {
      this.rethrow(err);
    }
  }

  async removeCategory(id: string) {
    const [row] = await this.db
      .select({ id: subscriptionCategories.id })
      .from(subscriptionCategories)
      .where(eq(subscriptionCategories.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Category not found');
    await this.db
      .delete(subscriptionCategories)
      .where(eq(subscriptionCategories.id, id));
    // Deleting a group drops every holder to the free plan; reconcile now
    // rather than waiting for the recurring sweep.
    await this.entitlementsScheduler.enqueueConfigReconcile();
    return { id };
  }

  // ── Packages (a group's tier and limits) ────────────────
  listPackages(categoryId?: string) {
    return this.db
      .select()
      .from(subscriptionPackages)
      .where(
        categoryId
          ? eq(subscriptionPackages.categoryId, categoryId)
          : undefined,
      )
      .orderBy(asc(subscriptionPackages.sortOrder));
  }

  async createPackage(dto: CreateSubPackageDto) {
    try {
      const [row] = await this.db
        .insert(subscriptionPackages)
        .values({
          categoryId: dto.categoryId,
          tier: dto.tier,
          name: tierLabel(dto.tier),
          photos: dto.photos ?? 0,
          ads: dto.ads ?? 0,
          renews: dto.renews ?? 0,
          autoRenews: dto.autoRenews ?? 0,
          videos: dto.videos ?? 0,
          sortOrder: tierRank(dto.tier),
          isActive: dto.isActive ?? true,
        })
        .returning();
      return row;
    } catch (err) {
      this.rethrow(
        err,
        `This group already has a ${tierLabel(dto.tier)} tier. Edit it instead.`,
      );
    }
  }

  async updatePackage(id: string, dto: UpdateSubPackageDto) {
    const patch: Partial<SubscriptionPackageRow> = {};
    if (dto.tier !== undefined) {
      patch.tier = dto.tier;
      patch.name = tierLabel(dto.tier);
      patch.sortOrder = tierRank(dto.tier);
    }
    if (dto.photos !== undefined) patch.photos = dto.photos;
    if (dto.ads !== undefined) patch.ads = dto.ads;
    if (dto.renews !== undefined) patch.renews = dto.renews;
    if (dto.autoRenews !== undefined) patch.autoRenews = dto.autoRenews;
    if (dto.videos !== undefined) patch.videos = dto.videos;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    try {
      const rows = Object.keys(patch).length
        ? await this.db
            .update(subscriptionPackages)
            .set(patch)
            .where(eq(subscriptionPackages.id, id))
            .returning()
        : await this.db
            .select()
            .from(subscriptionPackages)
            .where(eq(subscriptionPackages.id, id));
      if (!rows.length) throw new NotFoundException('Package not found');
      return rows[0];
    } catch (err) {
      this.rethrow(
        err,
        dto.tier
          ? `This group already has a ${tierLabel(dto.tier)} tier. Edit it instead.`
          : 'This package already exists.',
      );
    }
  }

  async removePackage(id: string) {
    const [row] = await this.db
      .select({ id: subscriptionPackages.id })
      .from(subscriptionPackages)
      .where(eq(subscriptionPackages.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Package not found');
    await this.db
      .delete(subscriptionPackages)
      .where(eq(subscriptionPackages.id, id));
    return { id };
  }

  // ── Terms ───────────────────────────────────────────────
  listTerms(packageId?: string) {
    return this.db
      .select()
      .from(subscriptionTerms)
      .where(packageId ? eq(subscriptionTerms.packageId, packageId) : undefined)
      .orderBy(asc(subscriptionTerms.sortOrder));
  }

  async createTerm(dto: CreateSubTermDto) {
    const clash = await this.db
      .select({ id: subscriptionTerms.id })
      .from(subscriptionTerms)
      .where(
        and(
          eq(subscriptionTerms.packageId, dto.packageId),
          eq(subscriptionTerms.durationValue, dto.durationMonths),
          eq(subscriptionTerms.durationUnit, 'month'),
          eq(subscriptionTerms.isActive, true),
        ),
      )
      .limit(1);
    if (clash.length > 0) {
      throw new ConflictException(
        `This package already has a ${termLabel(dto.durationMonths)} term. Edit it instead.`,
      );
    }
    try {
      const [row] = await this.db
        .insert(subscriptionTerms)
        .values({
          packageId: dto.packageId,
          name: termLabel(dto.durationMonths),
          durationValue: dto.durationMonths,
          durationUnit: 'month',
          price: dto.price.toString(),
          discount: (dto.discount ?? 0).toString(),
          discountType: dto.discountType ?? 'amount',
          sortOrder: termRank(dto.durationMonths),
          isActive: dto.isActive ?? true,
        })
        .returning();
      return row;
    } catch (err) {
      this.rethrow(err);
    }
  }

  async updateTerm(id: string, dto: UpdateSubTermDto) {
    const [current] = await this.db
      .select()
      .from(subscriptionTerms)
      .where(eq(subscriptionTerms.id, id))
      .limit(1);
    if (!current) throw new NotFoundException('Term not found');

    const nextMonths = dto.durationMonths ?? current.durationValue;
    const nextUnit =
      dto.durationMonths !== undefined ? 'month' : current.durationUnit;
    const nextActive = dto.isActive ?? current.isActive;
    // A retired (non 3/6/12-month) term must never come back on sale.
    if (nextActive && !isPickerTerm(nextMonths, nextUnit)) {
      throw new BadRequestException(
        'Only 3, 6 and 12-month terms can be active.',
      );
    }

    const patch: Partial<SubscriptionTermRow> = {};
    if (dto.durationMonths !== undefined) {
      patch.durationValue = dto.durationMonths;
      patch.durationUnit = 'month';
      patch.name = termLabel(dto.durationMonths);
      patch.sortOrder = termRank(dto.durationMonths);
    }
    if (dto.price !== undefined) patch.price = dto.price.toString();
    if (dto.discount !== undefined) patch.discount = dto.discount.toString();
    if (dto.discountType !== undefined) patch.discountType = dto.discountType;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    if (nextActive) {
      const clash = await this.db
        .select({ id: subscriptionTerms.id })
        .from(subscriptionTerms)
        .where(
          and(
            eq(subscriptionTerms.packageId, current.packageId),
            eq(subscriptionTerms.durationValue, nextMonths),
            eq(subscriptionTerms.durationUnit, nextUnit),
            eq(subscriptionTerms.isActive, true),
            ne(subscriptionTerms.id, id),
          ),
        )
        .limit(1);
      if (clash.length > 0) {
        throw new ConflictException(
          `This package already has a ${termLabel(nextMonths)} term.`,
        );
      }
    }

    try {
      const rows = Object.keys(patch).length
        ? await this.db
            .update(subscriptionTerms)
            .set(patch)
            .where(eq(subscriptionTerms.id, id))
            .returning()
        : await this.db
            .select()
            .from(subscriptionTerms)
            .where(eq(subscriptionTerms.id, id));
      if (!rows.length) throw new NotFoundException('Term not found');
      return rows[0];
    } catch (err) {
      this.rethrow(err);
    }
  }

  async removeTerm(id: string) {
    const [row] = await this.db
      .select({ id: subscriptionTerms.id })
      .from(subscriptionTerms)
      .where(eq(subscriptionTerms.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Term not found');
    await this.db.delete(subscriptionTerms).where(eq(subscriptionTerms.id, id));
    return { id };
  }

  // ── Free plan ───────────────────────────────────────────
  async getFreePlan() {
    const [[settings], adLimits] = await Promise.all([
      this.db.select().from(freePlanSettings).limit(1),
      this.db
        .select({
          id: freePlanAdLimits.id,
          categoryId: freePlanAdLimits.categoryId,
          subcategoryId: freePlanAdLimits.subcategoryId,
          ads: freePlanAdLimits.ads,
        })
        .from(freePlanAdLimits),
    ]);
    return { ...toFreePlanSettings(settings), adLimits };
  }

  /** Replaces the whole free plan in one transaction, then reconciles ads. */
  async updateFreePlan(dto: UpdateFreePlanDto) {
    const seen = new Set<string>();
    for (const limit of dto.adLimits) {
      const scope = limit.subcategoryId
        ? `sub:${limit.subcategoryId}`
        : `cat:${limit.categoryId}`;
      if (!limit.categoryId === !limit.subcategoryId) {
        throw new BadRequestException(
          'Each ad limit needs exactly one of categoryId or subcategoryId',
        );
      }
      if (seen.has(scope)) {
        throw new BadRequestException('An ad limit is listed twice');
      }
      seen.add(scope);
    }

    const settings = {
      photos: dto.photos,
      renews: dto.renews,
      autoRenews: dto.autoRenews,
      videos: dto.videos,
      otherAds: dto.otherAds,
    };
    await this.db
      .transaction(async (tx) => {
        await tx
          .insert(freePlanSettings)
          .values({ id: 1, ...settings })
          .onConflictDoUpdate({ target: freePlanSettings.id, set: settings });
        await tx.delete(freePlanAdLimits);
        if (dto.adLimits.length > 0) {
          await tx.insert(freePlanAdLimits).values(
            dto.adLimits.map((limit) => ({
              categoryId: limit.subcategoryId ? null : limit.categoryId,
              subcategoryId: limit.subcategoryId ?? null,
              ads: limit.ads,
            })),
          );
        }
      })
      .catch((err: unknown) => {
        if ((err as { code?: string } | null)?.code === '23505') {
          throw new ConflictException(
            'The free plan was just changed by someone else. Reload and try again.',
          );
        }
        this.rethrow(err);
      });

    await this.entitlementsScheduler.enqueueConfigReconcile();
    return this.getFreePlan();
  }

  private rethrow(
    err: unknown,
    conflictMessage = 'Slug already in use',
  ): never {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === '23505') throw new ConflictException(conflictMessage);
    if (code === '23503')
      throw new BadRequestException('Parent does not exist');
    throw err;
  }
}
