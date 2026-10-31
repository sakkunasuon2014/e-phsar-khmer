import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import {
  subcategories,
  subcategoryTranslations,
} from '../db/schema/categories.schema';
import type { SubcategoryRow } from '../db/schema/categories.schema';
import type { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import type { UpdateSubcategoryDto } from './dto/update-subcategory.dto';
import { FilesService } from '../files/files.service';

export interface AdminSubcategory {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  nameKm: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminSubcategoriesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly files: FilesService,
  ) {}

  async list(categoryId?: string): Promise<AdminSubcategory[]> {
    const kmTr = alias(subcategoryTranslations, 'km_sub_tr');
    const rows = await this.db
      .select({
        id: subcategories.id,
        categoryId: subcategories.categoryId,
        slug: subcategories.slug,
        icon: subcategories.icon,
        sortOrder: subcategories.sortOrder,
        isActive: subcategories.isActive,
        createdAt: subcategories.createdAt,
        updatedAt: subcategories.updatedAt,
        name: subcategoryTranslations.name,
        nameKm: kmTr.name,
      })
      .from(subcategories)
      .leftJoin(
        subcategoryTranslations,
        and(
          eq(subcategoryTranslations.subcategoryId, subcategories.id),
          eq(subcategoryTranslations.locale, 'en'),
        ),
      )
      .leftJoin(
        kmTr,
        and(eq(kmTr.subcategoryId, subcategories.id), eq(kmTr.locale, 'km')),
      )
      .where(categoryId ? eq(subcategories.categoryId, categoryId) : undefined)
      .orderBy(asc(subcategories.sortOrder));

    return rows.map((r) => ({
      ...r,
      name: r.name ?? r.slug,
      nameKm: r.nameKm ?? null,
    }));
  }

  async create(dto: CreateSubcategoryDto): Promise<AdminSubcategory> {
    try {
      return await this.db.transaction(async (tx) => {
        const [sub] = await tx
          .insert(subcategories)
          .values({
            categoryId: dto.categoryId,
            slug: dto.slug,
            icon: dto.icon ?? null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
          })
          .returning();

        await tx.insert(subcategoryTranslations).values({
          subcategoryId: sub.id,
          locale: 'en',
          name: dto.name,
        });

        const nameKm = dto.nameKm?.trim() || null;
        if (nameKm) {
          await tx.insert(subcategoryTranslations).values({
            subcategoryId: sub.id,
            locale: 'km',
            name: nameKm,
          });
        }

        return this.shape(sub, dto.name, nameKm);
      });
    } catch (err) {
      this.rethrow(err);
    }
  }

  async update(
    id: string,
    dto: UpdateSubcategoryDto,
  ): Promise<AdminSubcategory> {
    let oldIcon: string | null = null;
    try {
      const result = await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: subcategories.id, icon: subcategories.icon })
          .from(subcategories)
          .where(eq(subcategories.id, id))
          .limit(1);
        if (!existing) throw new NotFoundException('Subcategory not found');
        oldIcon = existing.icon;

        const patch: Partial<SubcategoryRow> = {};
        if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
        if (dto.slug !== undefined) patch.slug = dto.slug;
        if (dto.icon !== undefined) patch.icon = dto.icon;
        if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
        if (dto.isActive !== undefined) patch.isActive = dto.isActive;
        if (Object.keys(patch).length > 0) {
          await tx
            .update(subcategories)
            .set(patch)
            .where(eq(subcategories.id, id));
        }

        if (dto.name !== undefined) {
          await tx
            .insert(subcategoryTranslations)
            .values({ subcategoryId: id, locale: 'en', name: dto.name })
            .onConflictDoUpdate({
              target: [
                subcategoryTranslations.subcategoryId,
                subcategoryTranslations.locale,
              ],
              set: { name: dto.name },
            });
        }

        if (dto.nameKm !== undefined) {
          const nameKm = dto.nameKm?.trim();
          if (nameKm) {
            await tx
              .insert(subcategoryTranslations)
              .values({ subcategoryId: id, locale: 'km', name: nameKm })
              .onConflictDoUpdate({
                target: [
                  subcategoryTranslations.subcategoryId,
                  subcategoryTranslations.locale,
                ],
                set: { name: nameKm },
              });
          } else {
            await tx
              .delete(subcategoryTranslations)
              .where(
                and(
                  eq(subcategoryTranslations.subcategoryId, id),
                  eq(subcategoryTranslations.locale, 'km'),
                ),
              );
          }
        }

        const [sub] = await tx
          .select()
          .from(subcategories)
          .where(eq(subcategories.id, id))
          .limit(1);
        const [t] = await tx
          .select({ name: subcategoryTranslations.name })
          .from(subcategoryTranslations)
          .where(
            and(
              eq(subcategoryTranslations.subcategoryId, id),
              eq(subcategoryTranslations.locale, 'en'),
            ),
          )
          .limit(1);
        const [km] = await tx
          .select({ name: subcategoryTranslations.name })
          .from(subcategoryTranslations)
          .where(
            and(
              eq(subcategoryTranslations.subcategoryId, id),
              eq(subcategoryTranslations.locale, 'km'),
            ),
          )
          .limit(1);
        return this.shape(sub, t?.name ?? sub.slug, km?.name ?? null);
      });
      if (dto.icon !== undefined && oldIcon && dto.icon !== oldIcon) {
        await this.files.removeByPublicUrl(oldIcon);
      }
      return result;
    } catch (err) {
      this.rethrow(err);
    }
  }

  async remove(id: string): Promise<{ id: string }> {
    const [existing] = await this.db
      .select({ icon: subcategories.icon })
      .from(subcategories)
      .where(eq(subcategories.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Subcategory not found');

    await this.db.delete(subcategories).where(eq(subcategories.id, id));
    await this.files.removeByPublicUrl(existing.icon);
    return { id };
  }

  private shape(
    sub: SubcategoryRow,
    name: string,
    nameKm: string | null,
  ): AdminSubcategory {
    return {
      id: sub.id,
      categoryId: sub.categoryId,
      slug: sub.slug,
      name,
      nameKm,
      icon: sub.icon,
      sortOrder: sub.sortOrder,
      isActive: sub.isActive,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  }

  private rethrow(err: unknown): never {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === '23505') {
      throw new ConflictException(
        'A subcategory with this slug already exists in that category',
      );
    }
    if (code === '23503') {
      throw new BadRequestException('categoryId does not exist');
    }
    throw err;
  }
}
