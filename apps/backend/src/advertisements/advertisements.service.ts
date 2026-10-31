import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import {
  advertisements,
  type AdvertisementPlacement,
  type AdvertisementRow,
} from '../db/schema/advertisements.schema';
import { FilesService } from '../files/files.service';
import type {
  CreateAdvertisementDto,
  UpdateAdvertisementDto,
} from './dto/advertisement.dto';

/** What the storefront gets: no storage path, no moderation fields. */
export interface PublicAdvertisementView {
  id: string;
  placement: AdvertisementPlacement;
  imageUrl: string;
  linkUrl: string | null;
  altText: string;
  sortOrder: number;
}

/** What the dashboard gets: the row plus the resolved URL. */
export interface AdminAdvertisementView extends PublicAdvertisementView {
  imagePath: string;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdvertisementsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly files: FilesService,
  ) {}

  /**
   * Storefront read. Inactive banners never leave this method, so switching a
   * banner off is an immediate, deploy-free take-down.
   */
  async listActive(
    placement?: AdvertisementPlacement,
  ): Promise<PublicAdvertisementView[]> {
    const rows = await this.db
      .select()
      .from(advertisements)
      .where(
        placement
          ? and(
              eq(advertisements.isActive, true),
              eq(advertisements.placement, placement),
            )
          : eq(advertisements.isActive, true),
      )
      .orderBy(
        asc(advertisements.sortOrder),
        asc(advertisements.createdAt),
        asc(advertisements.id),
      );
    return rows.map((row) => this.toPublicView(row));
  }

  async listAll(
    placement?: AdvertisementPlacement,
  ): Promise<AdminAdvertisementView[]> {
    const rows = await this.db
      .select()
      .from(advertisements)
      .where(placement ? eq(advertisements.placement, placement) : undefined)
      .orderBy(
        asc(advertisements.placement),
        asc(advertisements.sortOrder),
        asc(advertisements.createdAt),
      );
    return rows.map((row) => this.toAdminView(row));
  }

  async create(
    dto: CreateAdvertisementDto,
    createdById: string,
  ): Promise<AdminAdvertisementView> {
    const [row] = await this.db
      .insert(advertisements)
      .values({
        placement: dto.placement,
        imagePath: dto.imagePath,
        linkUrl: dto.linkUrl?.trim() || null,
        altText: dto.altText?.trim() ?? '',
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        // A staff account that has since been deleted still leaves a banner.
        createdById,
      })
      .returning();
    return this.toAdminView(row);
  }

  async update(
    id: string,
    dto: UpdateAdvertisementDto,
  ): Promise<AdminAdvertisementView> {
    const [existing] = await this.db
      .select()
      .from(advertisements)
      .where(eq(advertisements.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Advertisement not found');

    const [row] = await this.db
      .update(advertisements)
      .set({
        placement: dto.placement ?? existing.placement,
        imagePath: dto.imagePath ?? existing.imagePath,
        linkUrl:
          dto.linkUrl === undefined
            ? existing.linkUrl
            : dto.linkUrl.trim() || null,
        altText: dto.altText === undefined ? existing.altText : dto.altText,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        isActive: dto.isActive ?? existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(advertisements.id, id))
      .returning();

    // Only when the image actually changed, and only after the write commits:
    // FilesService.remove logs and never throws, so a storage hiccup can never
    // roll back a banner edit the admin already made.
    if (dto.imagePath && dto.imagePath !== existing.imagePath) {
      await this.files.remove(this.files.getDefaultBucket(), [
        existing.imagePath,
      ]);
    }
    return this.toAdminView(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .delete(advertisements)
      .where(eq(advertisements.id, id))
      .returning({
        id: advertisements.id,
        imagePath: advertisements.imagePath,
      });
    if (!row) throw new NotFoundException('Advertisement not found');
    await this.files.remove(this.files.getDefaultBucket(), [row.imagePath]);
    return { id: row.id };
  }

  private toPublicView(row: AdvertisementRow): PublicAdvertisementView {
    return {
      id: row.id,
      placement: row.placement,
      imageUrl: this.files.publicUrlFor(row.imagePath),
      linkUrl: row.linkUrl,
      altText: row.altText,
      sortOrder: row.sortOrder,
    };
  }

  private toAdminView(row: AdvertisementRow): AdminAdvertisementView {
    return {
      ...this.toPublicView(row),
      imagePath: row.imagePath,
      isActive: row.isActive,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
