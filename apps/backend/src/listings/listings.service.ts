import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
  inArray,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import { FilesService } from '../files/files.service';
import { ReactionsService } from '../reactions/reactions.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { activePaidSubscriptionExistsSql } from '../subscriptions/verified-account.util';
import { parseAttributeFilters } from './attribute-filters';
import { ProductsService } from '../products/products.service';
import type { ProductRef } from '../products/products.service';
import type { DbClient, DbExecutor } from '../db/drizzle.provider';
import { listingPhotos, listings } from '../db/schema/listings.schema';
import { listingRenewals } from '../db/schema/subscriptions.schema';
import { listingEvents } from '../db/schema/insights.schema';
import { listingLikes, listingSaves } from '../db/schema/reactions.schema';
import type {
  ListingPhotoRow,
  ListingRow,
  NewListing,
} from '../db/schema/listings.schema';
import { categories, subcategories } from '../db/schema/categories.schema';
import {
  communes,
  districts,
  provinces,
  users,
} from '../db/schema/users.schema';
import type { CreateListingDto } from './dto/create-listing.dto';
import type { UpdateListingDto } from './dto/update-listing.dto';
import type { QueryListingsDto } from './dto/query-listings.dto';
import type { PaginationMeta } from '../common/types/api-response.types';
import {
  cursorPredicate,
  decodeCursor,
  encodeCursor,
  orderByFor,
  sortKeyExpr,
} from './feed-cursor';
import {
  canFuzzy,
  keywordCondition,
  resolveFeedOrdering,
} from './keyword-search';
import {
  TRENDING_CACHE_MS,
  TRENDING_LIKE_WEIGHT,
  TRENDING_LIMIT,
  TRENDING_SAVE_WEIGHT,
  TRENDING_WINDOW_DAYS,
  trendingEventScoreSql,
} from './trending';
import type { QueryTrendingDto } from './dto/query-trending.dto';

export interface ListingWithPhotos extends ListingRow {
  photos: ListingPhotoRow[];
  /**
   * The owner's handle, so a client can link to their profile.
   *
   * Optional because only `findById` resolves it: the mutation paths
   * (`update`/`publish`/`remove`) return the row they wrote from their own
   * queries and have no use for it.
   */
  sellerUsername?: string | null;
  /**
   * Whether the seller holds an active paid subscription — the card/profile
   * "Verified Account" badge. Present on the public feed, the detail read and
   * the trending strip; derived by an EXISTS subquery, never stored.
   */
  sellerVerifiedAccount?: boolean;
  /**
   * How many users liked this listing — resolved by `findById` only (same
   * reasoning as `sellerUsername`), so the detail page's "N Likes" control
   * starts truthful. Counted on read; there is no counter column to drift.
   */
  likeCount?: number;
  /**
   * The trusted spec page linked to this ad, resolved by `findById` only.
   * Null when the listing has no `productModelId`, or the spec has since been
   * unpublished / its brand or model deactivated — the detail page hides the
   * "View full specs" link on null, while `productModelId` still reports the
   * stored link.
   */
  product?: ProductRef | null;
}

export interface FeedFacet {
  slug: string;
  count: number;
}

export interface FeedMeta extends PaginationMeta {
  /** Present only with `includeFacets=true`. */
  facets?: { categories: FeedFacet[]; subcategories?: FeedFacet[] };
  /** Present when nothing matched exactly and typo-tolerant results are shown. */
  fuzzy?: true;
}

interface ResolvedFilters {
  categoryId?: string;
  subcategoryId?: string;
  /** Scope of the subcategory facet: the chosen category, else the chosen subcategory's parent. */
  facetCategoryId?: string;
  geo: SQL[];
}

/**
 * What a listing's status means to a client. Nothing flips `status` when the
 * 30-day window closes (see `liveConditions`), so a lapsed `active` row must
 * read as `expired` wherever the stored word would otherwise claim it is live.
 */
function effectiveStatus(
  listing: Pick<ListingRow, 'status' | 'expiresAt'>,
): ListingRow['status'] {
  const lapsed =
    listing.expiresAt !== null && listing.expiresAt.getTime() <= Date.now();
  // A lapsed restricted ad is no longer "hidden over the limit": it is an
  // expired ad the owner can renew once they have a free slot.
  return lapsed &&
    (listing.status === 'active' || listing.status === 'restricted')
    ? 'expired'
    : listing.status;
}

@Injectable()
export class ListingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly filesService: FilesService,
    private readonly reactionsService: ReactionsService,
    private readonly entitlements: EntitlementsService,
    private readonly products: ProductsService,
  ) {}

  /**
   * Per-process trend cache. Ranking aggregates the engagement window, so it
   * is the heaviest public read; a five-minute-old list is indistinguishable
   * to a visitor and keeps the home page off the event table.
   */
  private readonly trendingCache = new Map<
    string,
    { at: number; rows: ListingWithPhotos[] }
  >();

  async create(
    userId: string,
    dto: CreateListingDto,
  ): Promise<ListingWithPhotos> {
    await this.entitlements.assertPhotos(
      userId,
      { categoryId: dto.categoryId, subcategoryId: dto.subcategoryId },
      dto.photos?.length ?? 0,
    );

    const [cat] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, dto.categoryId))
      .limit(1);
    if (!cat) throw new NotFoundException('Category not found');

    const [sub] = await this.db
      .select({ id: subcategories.id })
      .from(subcategories)
      .where(
        and(
          eq(subcategories.id, dto.subcategoryId),
          eq(subcategories.categoryId, dto.categoryId),
        ),
      )
      .limit(1);
    if (!sub) throw new NotFoundException('Subcategory not found');

    // The web has no draft surface, so a create that cannot be published is
    // an invisible row. Check the allowance here too: an over-limit post never
    // creates anything, even for a client that skips the publish step.
    await this.entitlements.assertCanHoldAnotherAd(userId, dto);

    // Trusted spec link: only a published page is a legal target. The read
    // happens before the transactional write (see the TOCTOU note in the
    // products service); the column is nullable for pre-existing ads.
    if (dto.productModelId) {
      await this.products.assertPublishedModel(
        dto.productModelId,
        dto.subcategoryId,
      );
    }

    const values: NewListing = {
      userId,
      categoryId: dto.categoryId,
      subcategoryId: dto.subcategoryId,
      title: dto.title,
      description: dto.description ?? null,
      price: dto.price != null ? String(dto.price) : null,
      currency: 'USD',
      discountValue:
        dto.discountValue != null ? String(dto.discountValue) : null,
      discountType: dto.discountType ?? null,
      condition: dto.condition ?? null,
      attributes: dto.attributes ?? {},
      location: dto.location ?? null,
      address: dto.address ?? null,
      latitude: dto.latitude != null ? String(dto.latitude) : null,
      longitude: dto.longitude != null ? String(dto.longitude) : null,
      provinceId: dto.provinceId ?? null,
      districtId: dto.districtId ?? null,
      communeId: dto.communeId ?? null,
      productModelId: dto.productModelId ?? null,
      deliveryFree: dto.deliveryFree ?? false,
      contactName: dto.contactName ?? null,
      contactPhones: dto.contactPhones ?? [],
      contactEmail: dto.contactEmail ?? null,
      status: 'draft',
    };

    this.assertPhotosOwned(userId, dto.photos ?? []);

    return this.db.transaction(async (tx) => {
      const [listing] = await tx.insert(listings).values(values).returning();

      const photos: ListingPhotoRow[] = [];
      if (dto.photos && dto.photos.length > 0) {
        const rows = await tx
          .insert(listingPhotos)
          .values(
            dto.photos.map((p) => ({
              listingId: listing.id,
              url: p.url,
              path: p.path,
              sort: p.sort,
            })),
          )
          .returning();
        photos.push(...rows);
      }

      return { ...listing, photos };
    });
  }

  /**
   * Every photo must be an object this user uploaded (`listing/{userId}/…`,
   * the folder `/files/sign` hands them) whose URL is that object's own public
   * URL. Photos already on the listing are exempt, so ads created before the
   * per-user folders existed can still be edited.
   *
   * Without this a payload could reference anyone's object — and since a photo
   * dropped on a later edit is deleted from storage, that would let a user
   * delete other users' images.
   */
  private assertPhotosOwned(
    userId: string,
    photos: ReadonlyArray<{ url: string; path: string }>,
    alreadyOnListing: ReadonlyArray<{ url: string; path: string }> = [],
  ): void {
    const key = (p: { url: string; path: string }) => `${p.path}\n${p.url}`;
    const kept = new Set(alreadyOnListing.map(key));
    for (const p of photos) {
      if (kept.has(key(p))) continue;
      if (
        !this.filesService.isOwnedPath(p.path, userId) ||
        !p.path.startsWith(`listing/${userId}/`) ||
        p.url !== this.filesService.publicUrlFor(p.path)
      ) {
        throw new BadRequestException('INVALID_PHOTO');
      }
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateListingDto,
  ): Promise<ListingWithPhotos> {
    const existing = await this.findById(id);
    if (existing.userId !== userId)
      throw new ForbiddenException('Not the listing owner');
    if (existing.moderatedAt) {
      throw new ForbiddenException({
        code: 'LISTING_REMOVED_BY_ADMIN',
        message: 'This ad was removed by an administrator.',
      });
    }

    if (dto.photos !== undefined) {
      await this.entitlements.assertPhotos(
        userId,
        existing,
        dto.photos.length,
        existing.photos.length,
      );
      this.assertPhotosOwned(userId, dto.photos, existing.photos);
    }

    const updates: Partial<ListingRow> = { updatedAt: new Date() };
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.price !== undefined)
      updates.price = dto.price != null ? String(dto.price) : null;
    if (dto.discountValue !== undefined)
      updates.discountValue =
        dto.discountValue != null ? String(dto.discountValue) : null;
    if (dto.discountType !== undefined)
      updates.discountType = dto.discountType ?? null;
    if (dto.condition !== undefined) updates.condition = dto.condition ?? null;
    if (dto.attributes !== undefined) updates.attributes = dto.attributes;
    if (dto.productModelId !== undefined) {
      if (dto.productModelId) {
        await this.products.assertPublishedModel(
          dto.productModelId,
          existing.subcategoryId,
        );
      }
      updates.productModelId = dto.productModelId ?? null;
    }
    if (dto.location !== undefined) updates.location = dto.location;
    if (dto.address !== undefined) updates.address = dto.address;
    if (dto.latitude !== undefined)
      updates.latitude = dto.latitude != null ? String(dto.latitude) : null;
    if (dto.longitude !== undefined)
      updates.longitude = dto.longitude != null ? String(dto.longitude) : null;
    if (dto.provinceId !== undefined) updates.provinceId = dto.provinceId;
    if (dto.districtId !== undefined) updates.districtId = dto.districtId;
    if (dto.communeId !== undefined) updates.communeId = dto.communeId;
    if (dto.deliveryFree !== undefined) updates.deliveryFree = dto.deliveryFree;
    if (dto.contactName !== undefined) updates.contactName = dto.contactName;
    if (dto.contactPhones !== undefined)
      updates.contactPhones = dto.contactPhones;
    if (dto.contactEmail !== undefined) updates.contactEmail = dto.contactEmail;

    // One transaction: the row update and the photo swap land together, so a
    // failure between the delete and the insert can't leave the ad photoless.
    const { updated, photos, dropped } = await this.db.transaction(
      async (tx) => {
        const [updated] = await tx
          .update(listings)
          .set(updates)
          .where(eq(listings.id, id))
          .returning();

        if (dto.photos === undefined) {
          const photos = await tx
            .select()
            .from(listingPhotos)
            .where(eq(listingPhotos.listingId, id))
            .orderBy(listingPhotos.sort);
          return { updated, photos, dropped: [] as string[] };
        }

        const before = await tx
          .select({ url: listingPhotos.url })
          .from(listingPhotos)
          .where(eq(listingPhotos.listingId, id));
        await tx.delete(listingPhotos).where(eq(listingPhotos.listingId, id));
        const photos =
          dto.photos.length > 0
            ? await tx
                .insert(listingPhotos)
                .values(
                  dto.photos.map((p) => ({
                    listingId: id,
                    url: p.url,
                    path: p.path,
                    sort: p.sort,
                  })),
                )
                .returning()
            : [];
        const keptUrls = new Set(dto.photos.map((p) => p.url));
        const dropped = before
          .map((p) => p.url)
          .filter((url) => !keptUrls.has(url));
        return { updated, photos, dropped };
      },
    );

    // Best-effort cleanup after commit, and only of this owner's own objects —
    // a URL that made it into the row from a pre-validation payload is never
    // trusted as a delete target.
    await Promise.all(
      dropped.map((url) =>
        this.filesService.removeOwnedByPublicUrl(url, userId),
      ),
    );

    return { ...updated, photos };
  }

  async findById(id: string): Promise<ListingWithPhotos> {
    // The owner's handle travels with the listing so a client never has to
    // guess it — the detail page's seller card used to derive one from the
    // free-text `contactName`, which is unrelated to the account and produced
    // links to profiles that do not exist. Left join: a soft-deleted owner
    // must not make their listing unreadable.
    const [row] = await this.db
      .select({
        listing: listings,
        sellerUsername: users.username,
        sellerVerifiedAccount: activePaidSubscriptionExistsSql(listings.userId),
      })
      .from(listings)
      .leftJoin(users, eq(users.id, listings.userId))
      .where(eq(listings.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Listing not found');

    const [photos, likeCount, product] = await Promise.all([
      this.db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.listingId, row.listing.id))
        .orderBy(listingPhotos.sort),
      this.reactionsService.countLikes(row.listing.id),
      row.listing.productModelId
        ? this.products.getPublishedRefByModelId(row.listing.productModelId)
        : Promise.resolve(null),
    ]);

    return {
      ...row.listing,
      photos,
      sellerUsername: row.sellerUsername ?? null,
      sellerVerifiedAccount: row.sellerVerifiedAccount ?? false,
      likeCount,
      product,
    };
  }

  async findFeed(
    query: QueryListingsDto,
  ): Promise<{ data: ListingWithPhotos[]; meta: FeedMeta }> {
    const limit = query.limit ?? 20;
    const ordering = resolveFeedOrdering(query.sort, query.q);
    const { sort } = ordering;
    if (
      query.minPrice != null &&
      query.maxPrice != null &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException('minPrice must not exceed maxPrice');
    }
    if (
      query.yearMin != null &&
      query.yearMax != null &&
      query.yearMin > query.yearMax
    ) {
      throw new BadRequestException('yearMin must not exceed yearMax');
    }

    const resolved = await this.resolveFilterIds(query);
    if (resolved === null) {
      return {
        data: [],
        meta: {
          nextCursor: null,
          hasMore: false,
          limit,
          ...(query.includeTotal ? { total: 0 } : {}),
          ...(query.includeFacets ? { facets: { categories: [] } } : {}),
        },
      };
    }

    const cursor = decodeCursor(query.cursor, sort);

    const run = async (fuzzy: boolean) => {
      // `common` is everything EXCEPT the category dimension — the facet
      // counts are computed over it, so choosing a category never zeroes the
      // others.
      const common: SQL[] = [
        ...this.liveConditions(),
        ...resolved.geo,
        ...this.feedConditions(query, { fuzzy }),
      ];
      const full = [...common, ...this.categoryConditions(resolved)];
      if (query.userId) full.push(eq(listings.userId, query.userId));
      const pageWhere = cursor
        ? [...full, cursorPredicate(cursor, ordering)]
        : full;
      const [rows, total, facets] = await Promise.all([
        this.db
          .select({
            ...getTableColumns(listings),
            sortKey: sortKeyExpr(ordering),
            sellerUsername: users.username,
            sellerVerifiedAccount: activePaidSubscriptionExistsSql(
              listings.userId,
            ),
          })
          .from(listings)
          .leftJoin(users, eq(users.id, listings.userId))
          .where(and(...pageWhere))
          .orderBy(...orderByFor(ordering))
          .limit(limit + 1),
        query.includeTotal ? this.countWhere(full) : undefined,
        query.includeFacets ? this.facetCounts(common, resolved) : undefined,
      ]);
      return { rows, total, facets };
    };

    // A later page stays in whatever mode its first page chose. A first page
    // that finds nothing exactly retries with typo tolerance ("toyta").
    let fuzzy = cursor?.f === true;
    let result = await run(fuzzy);
    if (!cursor && !fuzzy && result.rows.length === 0 && canFuzzy(query.q)) {
      fuzzy = true;
      result = await run(true);
    }
    const { rows, total, facets } = result;

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            s: sort,
            v: last.sortKey,
            id: last.id,
            ...(fuzzy ? { f: true as const } : {}),
          })
        : null;

    // `sortKey` only feeds the cursor; strip it from the response rows.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const data = page.map(({ sortKey, ...l }) => l);
    const photosMap = await this.batchLoadPhotos(data.map((l) => l.id));
    const dataWithPhotos = data.map((l) => ({
      ...l,
      photos: photosMap.get(l.id) ?? [],
    }));

    return {
      data: dataWithPhotos,
      meta: {
        nextCursor,
        hasMore,
        limit,
        ...(total !== undefined ? { total } : {}),
        ...(facets ? { facets } : {}),
        ...(fuzzy ? { fuzzy: true as const } : {}),
      },
    };
  }

  /**
   * Engagement-ranked "Trending" carousel.
   *
   * Score = weighted buyer actions from `listing_events` + likes + saves over
   * a rolling window. Impressions are excluded (they measure placement, not
   * demand). Only live listings rank; the tail is filled with the newest live
   * listings so the carousel is never empty. Deliberately not paginated: the
   * score moves as events land, so a cursor over it would skip or repeat rows.
   */
  async findTrending(query: QueryTrendingDto): Promise<{
    data: ListingWithPhotos[];
    meta: { limit: number; windowDays: number };
  }> {
    const limit = query.limit ?? TRENDING_LIMIT;
    const windowDays = query.windowDays ?? TRENDING_WINDOW_DAYS;
    const meta = { limit, windowDays };

    const cacheKey = `${limit}:${windowDays}`;
    const cached = this.trendingCache.get(cacheKey);
    if (cached && Date.now() - cached.at < TRENDING_CACHE_MS) {
      return { data: cached.rows, meta };
    }

    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Aggregates are derived tables rather than correlated subqueries: each
    // scans its window once, then joins, instead of running once per listing.
    const eventScores = this.db
      .select({
        listingId: listingEvents.listingId,
        score: trendingEventScoreSql().as('event_score'),
      })
      .from(listingEvents)
      .where(gte(listingEvents.createdAt, cutoff))
      .groupBy(listingEvents.listingId)
      .as('trend_events');

    // The owner's own like/save must not help their ad trend.
    const likeScores = this.db
      .select({
        listingId: listingLikes.listingId,
        score: sql<number>`(count(*) * ${TRENDING_LIKE_WEIGHT})::int`.as(
          'like_score',
        ),
      })
      .from(listingLikes)
      .innerJoin(listings, eq(listings.id, listingLikes.listingId))
      .where(
        and(
          gte(listingLikes.createdAt, cutoff),
          sql`${listingLikes.userId} <> ${listings.userId}`,
        ),
      )
      .groupBy(listingLikes.listingId)
      .as('trend_likes');

    const saveScores = this.db
      .select({
        listingId: listingSaves.listingId,
        score: sql<number>`(count(*) * ${TRENDING_SAVE_WEIGHT})::int`.as(
          'save_score',
        ),
      })
      .from(listingSaves)
      .innerJoin(listings, eq(listings.id, listingSaves.listingId))
      .where(
        and(
          gte(listingSaves.createdAt, cutoff),
          sql`${listingSaves.userId} <> ${listings.userId}`,
        ),
      )
      .groupBy(listingSaves.listingId)
      .as('trend_saves');

    const trendScore = sql<number>`(
      coalesce(${eventScores.score}, 0)
      + coalesce(${likeScores.score}, 0)
      + coalesce(${saveScores.score}, 0)
    )`;

    // `score` only feeds the ordering; strip it from the card contract.
    const rankedRows = await this.db
      .select({
        ...getTableColumns(listings),
        sellerUsername: users.username,
        sellerVerifiedAccount: activePaidSubscriptionExistsSql(listings.userId),
        score: trendScore,
      })
      .from(listings)
      .leftJoin(users, eq(users.id, listings.userId))
      .leftJoin(eventScores, eq(eventScores.listingId, listings.id))
      .leftJoin(likeScores, eq(likeScores.listingId, listings.id))
      .leftJoin(saveScores, eq(saveScores.listingId, listings.id))
      .where(and(...this.liveConditions(), sql`${trendScore} > 0`))
      .orderBy(desc(trendScore), desc(listings.createdAt), desc(listings.id))
      .limit(limit);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ranked = rankedRows.map(({ score, ...row }) => row);

    const fillCount = limit - ranked.length;
    let filled: typeof ranked = [];
    if (fillCount > 0) {
      const conditions = [...this.liveConditions()];
      if (ranked.length > 0) {
        conditions.push(
          notInArray(
            listings.id,
            ranked.map((row) => row.id),
          ),
        );
      }
      filled = await this.db
        .select({
          ...getTableColumns(listings),
          sellerUsername: users.username,
          sellerVerifiedAccount: activePaidSubscriptionExistsSql(
            listings.userId,
          ),
        })
        .from(listings)
        .leftJoin(users, eq(users.id, listings.userId))
        .where(and(...conditions))
        .orderBy(desc(listings.createdAt), desc(listings.id))
        .limit(fillCount);
    }

    const rows = [...ranked, ...filled];
    const photosMap = await this.batchLoadPhotos(rows.map((row) => row.id));
    const data = rows.map((row) => ({
      ...row,
      photos: photosMap.get(row.id) ?? [],
    }));

    this.trendingCache.set(cacheKey, { at: Date.now(), rows: data });
    return { data, meta };
  }

  /**
   * What makes a listing publicly visible: active AND not past its expiry.
   * Nothing flips `status` to 'expired' when `expires_at` passes (no job does
   * it yet), so the date itself must be checked or 30-day-old ads never leave
   * the feed. A null expiry (legacy/seeded rows) counts as live.
   */
  private liveConditions(): SQL[] {
    return [
      eq(listings.status, 'active'),
      or(isNull(listings.expiresAt), sql`${listings.expiresAt} > now()`)!,
    ];
  }

  async findMine(
    userId: string,
    query: QueryListingsDto,
  ): Promise<{ data: ListingWithPhotos[]; meta: PaginationMeta }> {
    const limit = query.limit ?? 20;
    const conditions: SQL[] = [eq(listings.userId, userId)];

    if (query.status === 'active') {
      // "Active" means live right now, not merely the stored word: an ad past
      // its 30-day window belongs to the Expired tab below.
      conditions.push(...this.liveConditions());
    } else if (query.status === 'expired') {
      conditions.push(
        or(
          eq(listings.status, 'expired'),
          and(
            inArray(listings.status, ['active', 'restricted']),
            isNotNull(listings.expiresAt),
            sql`${listings.expiresAt} <= now()`,
          ),
        )!,
      );
    } else if (query.status === 'restricted') {
      // Hidden-by-plan list: only rows still inside their window. A lapsed
      // restricted ad reads as expired (and is renewable) instead.
      conditions.push(
        eq(listings.status, 'restricted'),
        or(isNull(listings.expiresAt), sql`${listings.expiresAt} > now()`)!,
      );
    } else if (query.status) {
      conditions.push(
        eq(listings.status, query.status as ListingRow['status']),
      );
    }
    const keyword = keywordCondition(query.q);
    if (keyword) conditions.push(keyword);

    const resolved = await this.resolveFilterIds(query);
    if (resolved === null)
      return {
        data: [],
        meta: {
          nextCursor: null,
          hasMore: false,
          limit,
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
        },
      };
    conditions.push(...resolved.geo, ...this.categoryConditions(resolved));

    const offset =
      query.page && query.pageSize ? (query.page - 1) * query.pageSize : 0;

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(...conditions));

    const rows = await this.db
      .select()
      .from(listings)
      .where(and(...conditions))
      .orderBy(desc(listings.createdAt))
      .limit(limit)
      .offset(offset);

    const photosMap = await this.batchLoadPhotos(rows.map((l) => l.id));
    const dataWithPhotos = rows.map((l) => ({
      ...l,
      // Same derived status the public detail reports, so the owner's tabs and
      // the card badge never disagree with what browsing shows.
      status: effectiveStatus(l),
      photos: photosMap.get(l.id) ?? [],
    }));

    return {
      data: dataWithPhotos,
      meta: {
        nextCursor: null,
        hasMore: offset + rows.length < (countRow?.count ?? 0),
        limit,
        total: countRow?.count ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      },
    };
  }

  async publish(userId: string, id: string): Promise<ListingWithPhotos> {
    const existing = await this.findById(id);
    if (existing.userId !== userId)
      throw new ForbiddenException('Not the listing owner');

    if (existing.moderatedAt) {
      throw new ForbiddenException({
        code: 'LISTING_REMOVED_BY_ADMIN',
        message: 'This ad was removed by an administrator.',
      });
    }

    const now = new Date();
    const lapsed =
      existing.expiresAt !== null &&
      existing.expiresAt.getTime() <= now.getTime();
    // A restricted ad whose 30-day window is still open cannot be re-published
    // into a full plan; once it lapses it is a renewal like any expired ad.
    if (existing.status === 'restricted' && !lapsed) {
      throw new ForbiddenException({
        code: 'PLAN_RESTRICTED',
        message:
          'This ad is hidden because it is over your plan’s limit. Renew or upgrade your subscription to show it again.',
      });
    }
    if (existing.publishedAt === null) {
      // A brand-new ad: needs a free slot, and its photos must fit the plan.
      await this.entitlements.assertPhotos(
        userId,
        existing,
        existing.photos.length,
      );
      await this.entitlements.assertCanHoldAnotherAd(userId, existing);
    } else {
      // Re-publishing an ad that already went live is a renewal. An ad that
      // lapsed (or was deleted) is no longer counted, so it also needs a slot.
      await this.entitlements.assertCanRenew(userId, existing);
      const stillLive =
        existing.status === 'active' &&
        (existing.expiresAt === null || existing.expiresAt > now);
      if (!stillLive) {
        await this.entitlements.assertCanHoldAnotherAd(userId, existing);
      }
    }

    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // A renewal is an extra publish of an ad that already went live; the
    // extension and the window's spend log commit together, so the plan can
    // never count a renewal the ad did not get (or miss one it did).
    const isRenewal = existing.publishedAt !== null;
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(listings)
        .set({
          status: 'active',
          publishedAt: existing.publishedAt ?? now,
          expiresAt,
          renewCount: isRenewal ? existing.renewCount + 1 : existing.renewCount,
          updatedAt: now,
        })
        .where(eq(listings.id, id))
        .returning();
      if (isRenewal) {
        await tx.insert(listingRenewals).values({ listingId: id, userId });
      }
      return row;
    });

    // The count check above is not atomic with the write; settling here keeps
    // two parallel publishes from leaving the user over their allowance.
    await this.entitlements.reconcileListingsSafely(userId);

    return { ...updated, photos: existing.photos };
  }

  /**
   * Resolves the slug filters to ids. Returns null when any given slug is
   * unknown — callers short-circuit to an empty result rather than erroring.
   * The category dimension is kept apart from the geo conditions because the
   * facet counts must be able to drop it.
   */
  private async resolveFilterIds(
    query: QueryListingsDto,
  ): Promise<ResolvedFilters | null> {
    const resolved: ResolvedFilters = { geo: [] };

    if (query.categorySlug) {
      const [cat] = await this.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, query.categorySlug))
        .limit(1);
      if (!cat) return null;
      resolved.categoryId = cat.id;
      resolved.facetCategoryId = cat.id;
    }

    if (query.subcategorySlug) {
      const [sub] = await this.db
        .select({ id: subcategories.id, categoryId: subcategories.categoryId })
        .from(subcategories)
        .where(eq(subcategories.slug, query.subcategorySlug))
        .limit(1);
      if (!sub) return null;
      resolved.subcategoryId = sub.id;
      resolved.facetCategoryId ??= sub.categoryId;
    }

    if (query.provinceSlug) {
      const [prov] = await this.db
        .select({ id: provinces.id })
        .from(provinces)
        .where(eq(provinces.slug, query.provinceSlug))
        .limit(1);
      if (!prov) return null;
      resolved.geo.push(eq(listings.provinceId, prov.id));

      if (query.districtSlug) {
        const [dist] = await this.db
          .select({ id: districts.id })
          .from(districts)
          .where(
            and(
              eq(districts.provinceId, prov.id),
              eq(districts.slug, query.districtSlug),
            ),
          )
          .limit(1);
        if (!dist) return null;
        resolved.geo.push(eq(listings.districtId, dist.id));

        if (query.communeSlug) {
          const [com] = await this.db
            .select({ id: communes.id })
            .from(communes)
            .where(
              and(
                eq(communes.districtId, dist.id),
                eq(communes.slug, query.communeSlug),
              ),
            )
            .limit(1);
          if (!com) return null;
          resolved.geo.push(eq(listings.communeId, com.id));
        }
      }
    }

    return resolved;
  }

  private categoryConditions(resolved: ResolvedFilters): SQL[] {
    const out: SQL[] = [];
    if (resolved.categoryId)
      out.push(eq(listings.categoryId, resolved.categoryId));
    if (resolved.subcategoryId)
      out.push(eq(listings.subcategoryId, resolved.subcategoryId));
    return out;
  }

  /** The non-slug feed filters (keyword, price, condition, attributes, date, delivery). */
  private feedConditions(
    query: QueryListingsDto,
    { fuzzy = false }: { fuzzy?: boolean } = {},
  ): SQL[] {
    const out: SQL[] = [];

    const keyword = keywordCondition(query.q, { fuzzy });
    if (keyword) out.push(keyword);

    // Final (discounted) price — what the cards show. A null price is
    // "Negotiable" and drops out of any bounded range (null >= x is null).
    if (query.minPrice != null) {
      out.push(gte(listings.effectivePrice, String(query.minPrice)));
    }
    if (query.maxPrice != null) {
      out.push(lte(listings.effectivePrice, String(query.maxPrice)));
    }
    if (query.condition) {
      out.push(eq(listings.condition, query.condition));
    }
    // Attribute filters match the display names stored in `attributes` JSONB
    // (e.g. `attributes.brand = 'Toyota'`), which is what the post form writes.
    if (query.brand) {
      out.push(eq(sql`${listings.attributes}->>'brand'`, query.brand));
    }
    if (query.bodyType) {
      out.push(eq(sql`${listings.attributes}->>'bodyType'`, query.bodyType));
    }
    // The other attribute filters the browse dialog offers — same display-name
    // equality as `brand`/`bodyType`. The keys are literals in the query (never
    // caller-supplied paths); only the values are bound.
    if (query.model) {
      out.push(eq(sql`${listings.attributes}->>'model'`, query.model));
    }
    if (query.taxType) {
      out.push(eq(sql`${listings.attributes}->>'taxType'`, query.taxType));
    }
    if (query.color) {
      out.push(eq(sql`${listings.attributes}->>'color'`, query.color));
    }
    if (query.transmission) {
      out.push(
        eq(sql`${listings.attributes}->>'transmission'`, query.transmission),
      );
    }
    // Generic attribute filter for every grid that is NOT a car's Body Type.
    // The key is bound as a parameter (`->>$n`), never interpolated, and the
    // DTO additionally constrains it to a plain identifier — so this stays a
    // read of the JSONB, not a path injection. Half a filter (one param
    // without the other) applies nothing rather than erroring, matching how
    // `districtSlug` without `provinceSlug` is already treated.
    if (query.attrKey && query.attrValue) {
      out.push(
        eq(sql`${listings.attributes}->>${query.attrKey}`, query.attrValue),
      );
    }
    // Multi-attribute filter from the More Filters dialog: one JSON object,
    // one AND'ed condition per entry. Each key is bound (`->>$n`), never
    // interpolated; malformed or oversized input applies nothing.
    for (const [key, value] of parseAttributeFilters(query.attrs)) {
      out.push(eq(sql`${listings.attributes}->>${key}`, value));
    }

    // Model year lives in the JSONB as the display string ("2021"); anything
    // that is not four digits never matches a year bound instead of erroring.
    const year = sql`(CASE WHEN ${listings.attributes}->>'year' ~ '^[0-9]{4}$' THEN (${listings.attributes}->>'year')::int END)`;
    if (query.yearMin != null) out.push(sql`${year} >= ${query.yearMin}`);
    if (query.yearMax != null) out.push(sql`${year} <= ${query.yearMax}`);
    if (query.engineType) {
      out.push(
        eq(sql`${listings.attributes}->>'engineType'`, query.engineType),
      );
    }

    // "Went live" time: `published_at`, since a draft can sit for days before
    // it is published — falling back to `created_at` for active rows that
    // never went through publish (seeded/demo rows have no published_at, and
    // without the fallback no date filter could ever match them).
    const postedAt = sql`coalesce(${listings.publishedAt}, ${listings.createdAt})`;
    if (query.postedWithin === 'today') {
      out.push(
        sql`${postedAt} >= (date_trunc('day', now() AT TIME ZONE 'Asia/Phnom_Penh') AT TIME ZONE 'Asia/Phnom_Penh')`,
      );
    } else if (query.postedWithin === 'week') {
      out.push(sql`${postedAt} >= now() - interval '7 days'`);
    } else if (query.postedWithin === 'month') {
      out.push(sql`${postedAt} >= now() - interval '30 days'`);
    }

    if (query.deliveryFree) {
      out.push(eq(listings.deliveryFree, true));
    }
    // A discount exists only when both fields are set and the value is
    // positive — the same rule the generated `effective_price` column uses.
    if (query.hasDiscount) {
      out.push(
        sql`${listings.discountValue} is not null and ${listings.discountValue} > 0 and ${listings.discountType} is not null`,
      );
    }
    return out;
  }

  private async countWhere(conditions: SQL[]): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(...conditions));
    return row?.count ?? 0;
  }

  /**
   * Per-category counts over `common` (every filter except the category
   * dimension), plus per-subcategory counts inside the selected category.
   * Zero-count rows are simply absent (GROUP BY). Ordered by the catalogue's
   * own sort_order so the list does not reshuffle as the counts change.
   */
  private async facetCounts(
    common: SQL[],
    resolved: ResolvedFilters,
  ): Promise<NonNullable<FeedMeta['facets']>> {
    const count = sql<number>`count(*)::int`;
    const [cats, subs] = await Promise.all([
      this.db
        .select({ slug: categories.slug, count })
        .from(listings)
        .innerJoin(categories, eq(listings.categoryId, categories.id))
        .where(and(...common))
        .groupBy(categories.id)
        .orderBy(categories.sortOrder, categories.slug),
      resolved.facetCategoryId
        ? this.db
            .select({ slug: subcategories.slug, count })
            .from(listings)
            .innerJoin(
              subcategories,
              eq(listings.subcategoryId, subcategories.id),
            )
            .where(
              and(...common, eq(listings.categoryId, resolved.facetCategoryId)),
            )
            .groupBy(subcategories.id)
            .orderBy(subcategories.sortOrder, subcategories.slug)
        : undefined,
    ]);
    return subs
      ? { categories: cats, subcategories: subs }
      : { categories: cats };
  }

  private async batchLoadPhotos(
    listingIds: string[],
  ): Promise<Map<string, ListingPhotoRow[]>> {
    if (listingIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(listingPhotos)
      .where(inArray(listingPhotos.listingId, listingIds))
      .orderBy(listingPhotos.sort);
    const map = new Map<string, ListingPhotoRow[]>();
    for (const row of rows) {
      const arr = map.get(row.listingId);
      if (arr) {
        arr.push(row);
      } else {
        map.set(row.listingId, [row]);
      }
    }
    return map;
  }

  async remove(userId: string, id: string): Promise<ListingWithPhotos> {
    const existing = await this.findById(id);
    if (existing.userId !== userId)
      throw new ForbiddenException('Not the listing owner');

    const [updated] = await this.db
      .update(listings)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(listings.id, id))
      .returning();

    const photos = await this.db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.listingId, id))
      .orderBy(listingPhotos.sort);

    // A removed ad frees a plan slot: settle the allowance now instead of
    // waiting for the ten-minute sweep, so the owner can post right away and
    // a restricted ad they made room for comes back immediately.
    await this.entitlements.reconcileListingsSafely(userId);

    return { ...updated, photos };
  }

  /**
   * The public detail read. A moderated ad is gone for everyone but its owner
   * (who sees it in `/me/all`) and staff (the admin listings page) — serving
   * it here would keep a removed scam reachable by its link.
   */
  async findPublicById(id: string): Promise<ListingWithPhotos> {
    const listing = await this.findById(id);
    if (listing.moderatedAt) throw new NotFoundException('Listing not found');
    // The public detail must not serve what the marketplace already hides:
    // a never-published draft, an ad its owner withdrew, or one hidden for
    // exceeding its plan's allowance. (Moderated rows are `deleted` too, and
    // are rejected just above with their own comment.)
    if (
      listing.status === 'draft' ||
      listing.status === 'deleted' ||
      listing.status === 'restricted'
    ) {
      throw new NotFoundException('Listing not found');
    }
    // A lapsed ad keeps its link (shares, old messages, search history) but
    // must read as expired — the page shows the notice and stops offering
    // contact instead of pretending the offer is still live.
    const status = effectiveStatus(listing);
    return status === listing.status ? listing : { ...listing, status };
  }

  /**
   * Staff take-down. Accepts the caller's transaction so approving a report
   * and removing its listing commit together.
   */
  async moderate(
    id: string,
    moderatorId: string,
    reason: string | null,
    executor: DbExecutor = this.db,
  ): Promise<ListingRow> {
    const [row] = await executor
      .update(listings)
      .set({
        status: 'deleted',
        moderatedAt: new Date(),
        moderatedById: moderatorId,
        moderationReason: reason?.slice(0, 500) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, id))
      .returning();
    if (!row) throw new NotFoundException('Listing not found');
    return row;
  }

  /**
   * Undoes a take-down. The ad comes back live if its 30-day window is still
   * open, otherwise as expired (a never-published draft stays a draft) — then
   * plan reconciliation runs, since a restored live ad takes one of the
   * owner's slots and may push another (or itself) into 'restricted'.
   */
  async restoreModerated(id: string): Promise<ListingRow> {
    const [existing] = await this.db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Listing not found');
    if (!existing.moderatedAt) {
      throw new BadRequestException('LISTING_NOT_MODERATED');
    }

    const now = new Date();
    const status =
      existing.publishedAt === null
        ? 'draft'
        : existing.expiresAt !== null && existing.expiresAt > now
          ? 'active'
          : 'expired';

    const [row] = await this.db
      .update(listings)
      .set({
        status,
        moderatedAt: null,
        moderatedById: null,
        moderationReason: null,
        updatedAt: now,
      })
      .where(and(eq(listings.id, id), isNotNull(listings.moderatedAt)))
      .returning();
    if (!row) throw new BadRequestException('LISTING_NOT_MODERATED');

    await this.entitlements.reconcileListingsSafely(existing.userId);
    return row;
  }
}
