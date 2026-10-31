import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { listingLikes, listingSaves } from '../db/schema/reactions.schema';
import { listingPhotos, listings } from '../db/schema/listings.schema';
import { users } from '../db/schema/users.schema';
import type { ListingPhotoRow, ListingRow } from '../db/schema/listings.schema';
import type { ListingWithPhotos } from '../listings/listings.service';
import type { ListReactionsDto } from './dto/list-reactions.dto';
import type { PaginatedResponse } from '../common/types/api-response.types';

/**
 * Likes and saves on listings — the two edge tables behind every heart and
 * bookmark in the UI.
 *
 * Both relations share one contract: POST is an idempotent create, DELETE is
 * an idempotent remove that never 404s on a missing edge (the toggle's end
 * state is the whole contract — a double-tap must land on "not liked", never
 * an error toast). The toggle responses carry the fresh `likeCount`, so the
 * detail page's counter stays in step without a refetch.
 */
@Injectable()
export class ReactionsService {
  constructor(@Inject(DRIZZLE) private readonly db: DbClient) {}

  /**
   * 404 unless the listing row exists — the POST side's guard. Deliberately
   * no status filter: the detail endpoint (`ListingsService.findById`) serves
   * any status, so a control that renders on that page must never be
   * present-but-refused. The DELETE side skips this on purpose (see below).
   */
  private async assertListingExists(listingId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!row) throw new NotFoundException('Listing not found');
  }

  /** Like a listing. Idempotent: re-liking is a silent no-op. */
  async likeListing(
    userId: string,
    listingId: string,
  ): Promise<{ liked: true; likeCount: number }> {
    await this.assertListingExists(listingId);

    await this.db
      .insert(listingLikes)
      .values({ userId, listingId })
      .onConflictDoNothing({
        target: [listingLikes.userId, listingLikes.listingId],
      });

    return { liked: true, likeCount: await this.countLikes(listingId) };
  }

  /**
   * Remove a like. Idempotent, and deliberately without the existence check
   * the POST side has: a hard-deleted listing's likes are already gone by
   * cascade, so the end state this call promises — "not liked" — is already
   * true. 404ing a stale unlike would only turn a toggle into an error toast
   * (the same reason `unfollowUser` never 404s).
   */
  async unlikeListing(
    userId: string,
    listingId: string,
  ): Promise<{ liked: false; likeCount: number }> {
    await this.db
      .delete(listingLikes)
      .where(
        and(
          eq(listingLikes.userId, userId),
          eq(listingLikes.listingId, listingId),
        ),
      );

    return { liked: false, likeCount: await this.countLikes(listingId) };
  }

  /** Save a listing. Idempotent: re-saving is a silent no-op. */
  async saveListing(
    userId: string,
    listingId: string,
  ): Promise<{ saved: true }> {
    await this.assertListingExists(listingId);

    await this.db
      .insert(listingSaves)
      .values({ userId, listingId })
      .onConflictDoNothing({
        target: [listingSaves.userId, listingSaves.listingId],
      });

    return { saved: true };
  }

  /**
   * Remove a save. Idempotent, and like the unlike it skips the existence
   * check: the toggle's end state is the whole contract, so a double-tap or
   * a stale page must land on "not saved", never on an error.
   */
  async unsaveListing(
    userId: string,
    listingId: string,
  ): Promise<{ saved: false }> {
    await this.db
      .delete(listingSaves)
      .where(
        and(
          eq(listingSaves.userId, userId),
          eq(listingSaves.listingId, listingId),
        ),
      );

    return { saved: false };
  }

  /**
   * The count the detail page shows. A single indexed count — no counter
   * column to drift (the follow counts are computed the same way).
   */
  async countLikes(listingId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(listingLikes)
      .where(eq(listingLikes.listingId, listingId));
    return row.value;
  }

  /**
   * Both id sets in one round trip — the single hydration call the web's
   * reaction provider makes, so every card on a page can light up from one
   * request instead of an N+1.
   */
  async getReactionIds(
    userId: string,
  ): Promise<{ liked: string[]; saved: string[] }> {
    const [liked, saved] = await Promise.all([
      this.db
        .select({ listingId: listingLikes.listingId })
        .from(listingLikes)
        .where(eq(listingLikes.userId, userId)),
      this.db
        .select({ listingId: listingSaves.listingId })
        .from(listingSaves)
        .where(eq(listingSaves.userId, userId)),
    ]);

    return {
      liked: liked.map((row) => row.listingId),
      saved: saved.map((row) => row.listingId),
    };
  }

  /** Liked listings for `/me/likes`, newest edge first. */
  async listLikedListings(
    userId: string,
    query: ListReactionsDto,
  ): Promise<PaginatedResponse<ListingWithPhotos>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    // `status != 'deleted'`: a removed ad must not sit in "my likes" — the
    // edge survives (the toggle contract), the list just stops showing it.
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ listing: listings, sellerUsername: users.username })
        .from(listingLikes)
        .innerJoin(listings, eq(listings.id, listingLikes.listingId))
        // The card on this page is the feed's card; the feed now resolves the
        // seller's handle, so these lists resolve it the same way.
        .leftJoin(users, eq(users.id, listings.userId))
        .where(
          and(
            eq(listingLikes.userId, userId),
            notInArray(listings.status, ['deleted', 'restricted']),
          ),
        )
        // `id` breaks ties so a page boundary can never repeat or skip a row
        // when several edges land on the same timestamp.
        .orderBy(desc(listingLikes.createdAt), desc(listingLikes.id))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(listingLikes)
        .innerJoin(listings, eq(listings.id, listingLikes.listingId))
        .where(
          and(
            eq(listingLikes.userId, userId),
            notInArray(listings.status, ['deleted', 'restricted']),
          ),
        ),
    ]);

    const total = totalRow.value;
    const pageRows = rows.map((row) => ({
      ...row.listing,
      sellerUsername: row.sellerUsername ?? null,
    }));

    return {
      data: await this.hydrateListings(pageRows),
      meta: {
        nextCursor: null,
        hasMore: offset + pageRows.length < total,
        limit: pageSize,
        total,
        page,
        pageSize,
      },
    };
  }

  /** Saved listings for `/me/saved`, newest edge first. */
  async listSavedListings(
    userId: string,
    query: ListReactionsDto,
  ): Promise<PaginatedResponse<ListingWithPhotos>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ listing: listings, sellerUsername: users.username })
        .from(listingSaves)
        .innerJoin(listings, eq(listings.id, listingSaves.listingId))
        // Same as the liked list: the feed's card needs the seller's handle.
        .leftJoin(users, eq(users.id, listings.userId))
        .where(
          and(
            eq(listingSaves.userId, userId),
            notInArray(listings.status, ['deleted', 'restricted']),
          ),
        )
        .orderBy(desc(listingSaves.createdAt), desc(listingSaves.id))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(listingSaves)
        .innerJoin(listings, eq(listings.id, listingSaves.listingId))
        .where(
          and(
            eq(listingSaves.userId, userId),
            notInArray(listings.status, ['deleted', 'restricted']),
          ),
        ),
    ]);

    const total = totalRow.value;
    const pageRows = rows.map((row) => ({
      ...row.listing,
      sellerUsername: row.sellerUsername ?? null,
    }));

    return {
      data: await this.hydrateListings(pageRows),
      meta: {
        nextCursor: null,
        hasMore: offset + pageRows.length < total,
        limit: pageSize,
        total,
        page,
        pageSize,
      },
    };
  }

  /**
   * Photos for a page of listings in one query — the same batch pattern the
   * public feed uses, so a list page costs three queries regardless of size.
   */
  private async hydrateListings(
    rows: ListingRow[],
  ): Promise<ListingWithPhotos[]> {
    if (rows.length === 0) return [];

    const photos = await this.db
      .select()
      .from(listingPhotos)
      .where(
        inArray(
          listingPhotos.listingId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(listingPhotos.sort);

    const byListing = new Map<string, ListingPhotoRow[]>();
    for (const photo of photos) {
      const list = byListing.get(photo.listingId);
      if (list) list.push(photo);
      else byListing.set(photo.listingId, [photo]);
    }

    return rows.map((row) => ({
      ...row,
      photos: byListing.get(row.id) ?? [],
    }));
  }
}
