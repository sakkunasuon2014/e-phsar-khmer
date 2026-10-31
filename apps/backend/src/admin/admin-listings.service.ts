import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { listings, listingPhotos } from '../db/schema/listings.schema';
import { categories, subcategories } from '../db/schema/categories.schema';
import { users } from '../db/schema/users.schema';
import { listingReports } from '../db/schema/reports.schema';
import type { PaginatedResponse } from '../common/types/api-response.types';
import { ListingsService } from '../listings/listings.service';
import type { ListAdminListingsDto } from './dto/list-admin-listings.dto';
import { likeTerm } from '../utils/like-term';

export interface AdminListingRow {
  id: string;
  title: string;
  status: string;
  price: string | null;
  currency: string;
  userId: string;
  sellerUsername: string | null;
  categorySlug: string | null;
  subcategorySlug: string | null;
  coverPhotoUrl: string | null;
  pendingReports: number;
  createdAt: Date;
  publishedAt: Date | null;
  expiresAt: Date | null;
  moderatedAt: Date | null;
  moderationReason: string | null;
}

/**
 * The admin side of listings: browse every ad regardless of status, and take
 * one down / put it back. The take-down itself lives in ListingsService
 * (`moderate` / `restoreModerated`) so the owner-facing guards and the admin
 * action share one definition of "moderated".
 */
@Injectable()
export class AdminListingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly listingsService: ListingsService,
  ) {}

  async list(
    dto: ListAdminListingsDto,
  ): Promise<PaginatedResponse<AdminListingRow>> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (dto.status) conditions.push(eq(listings.status, dto.status));
    if (dto.userId) conditions.push(eq(listings.userId, dto.userId));
    if (dto.categorySlug)
      conditions.push(eq(categories.slug, dto.categorySlug));
    if (dto.subcategorySlug)
      conditions.push(eq(subcategories.slug, dto.subcategorySlug));
    if (dto.moderated === true)
      conditions.push(isNotNull(listings.moderatedAt));
    if (dto.moderated === false) conditions.push(isNull(listings.moderatedAt));
    if (dto.q) conditions.push(ilike(listings.title, likeTerm(dto.q)));
    const where = conditions.length ? and(...conditions) : undefined;

    const pendingReports = sql<number>`(
      select count(*)::int from ${listingReports}
      where ${listingReports.listingId} = ${listings.id}
        and ${listingReports.status} = 'pending'
    )`;

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          id: listings.id,
          title: listings.title,
          status: listings.status,
          price: listings.price,
          currency: listings.currency,
          userId: listings.userId,
          sellerUsername: users.username,
          categorySlug: categories.slug,
          subcategorySlug: subcategories.slug,
          pendingReports,
          createdAt: listings.createdAt,
          publishedAt: listings.publishedAt,
          expiresAt: listings.expiresAt,
          moderatedAt: listings.moderatedAt,
          moderationReason: listings.moderationReason,
        })
        .from(listings)
        .leftJoin(users, eq(users.id, listings.userId))
        .leftJoin(categories, eq(categories.id, listings.categoryId))
        .leftJoin(subcategories, eq(subcategories.id, listings.subcategoryId))
        .where(where)
        .orderBy(desc(listings.createdAt), desc(listings.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ value: count() }).from(listings).where(where),
    ]);

    // First photo per listing, for the table thumbnail.
    const cover = new Map<string, string>();
    if (rows.length) {
      const photos = await this.db
        .select({ listingId: listingPhotos.listingId, url: listingPhotos.url })
        .from(listingPhotos)
        .where(
          inArray(
            listingPhotos.listingId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(listingPhotos.sort);
      for (const p of photos) {
        if (!cover.has(p.listingId)) cover.set(p.listingId, p.url);
      }
    }

    const total = totalRow.value;
    return {
      data: rows.map((r) => ({ ...r, coverPhotoUrl: cover.get(r.id) ?? null })),
      meta: {
        nextCursor: null,
        hasMore: offset + rows.length < total,
        limit: pageSize,
        total,
        page,
        pageSize,
      },
    };
  }

  remove(id: string, moderatorId: string, reason?: string) {
    return this.listingsService.moderate(id, moderatorId, reason ?? null);
  }

  restore(id: string) {
    return this.listingsService.restoreModerated(id);
  }
}
