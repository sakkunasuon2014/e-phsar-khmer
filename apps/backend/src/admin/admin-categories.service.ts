import {
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
  categories,
  categoryTranslations,
  subcategories,
} from '../db/schema/categories.schema';
import type { CategoryRow } from '../db/schema/categories.schema';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import { FilesService } from '../files/files.service';

export interface AdminCategory extends CategoryRow {
  name: string;
  nameKm: string | null;
}

@Injectable()
export class AdminCategoriesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly files: FilesService,
  ) {}

  async list(): Promise<AdminCategory[]> {
    const kmTr = alias(categoryTranslations, 'km_cat_tr');
    const rows = await this.db
      .select({
        id: categories.id,
        slug: categories.slug,
        icon: categories.icon,
        sortOrder: categories.sortOrder,
        isActive: categories.isActive,
        createdAt: categories.createdAt,
        updatedAt: categories.updatedAt,
        name: categoryTranslations.name,
        nameKm: kmTr.name,
      })
      .from(categories)
      .leftJoin(
        categoryTranslations,
        and(
          eq(categoryTranslations.categoryId, categories.id),
          eq(categoryTranslations.locale, 'en'),
        ),
      )
      .leftJoin(
        kmTr,
        and(eq(kmTr.categoryId, categories.id), eq(kmTr.locale, 'km')),
      )
      .orderBy(asc(categories.sortOrder));

    return rows.map((r) => ({
      ...r,
      name: r.name ?? r.slug,
      nameKm: r.nameKm ?? null,
    }));
  }

  async create(dto: CreateCategoryDto): Promise<AdminCategory> {
    try {
      return await this.db.transaction(async (tx) => {
        const [cat] = await tx
          .insert(categories)
          .values({
            slug: dto.slug,
            icon: dto.icon ?? null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
          })
          .returning();

        await tx.insert(categoryTranslations).values({
          categoryId: cat.id,
          locale: 'en',
          name: dto.name,
        });

        const nameKm = dto.nameKm?.trim() || null;
        if (nameKm) {
          await tx.insert(categoryTranslations).values({
            categoryId: cat.id,
            locale: 'km',
            name: nameKm,
          });
        }

        return { ...cat, name: dto.name, nameKm };
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('A category with this slug already exists');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<AdminCategory> {
    let oldIcon: string | null = null;
    try {
      const result = await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: categories.id, icon: categories.icon })
          .from(categories)
          .where(eq(categories.id, id))
          .limit(1);
        if (!existing) throw new NotFoundException('Category not found');
        oldIcon = existing.icon;

        const patch: Partial<CategoryRow> = {};
        if (dto.slug !== undefined) patch.slug = dto.slug;
        if (dto.icon !== undefined) patch.icon = dto.icon;
        if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
        if (dto.isActive !== undefined) patch.isActive = dto.isActive;
        if (Object.keys(patch).length > 0) {
          await tx.update(categories).set(patch).where(eq(categories.id, id));
        }

        if (dto.name !== undefined) {
          await tx
            .insert(categoryTranslations)
            .values({ categoryId: id, locale: 'en', name: dto.name })
            .onConflictDoUpdate({
              target: [
                categoryTranslations.categoryId,
                categoryTranslations.locale,
              ],
              set: { name: dto.name },
            });
        }

        if (dto.nameKm !== undefined) {
          const nameKm = dto.nameKm?.trim();
          if (nameKm) {
            await tx
              .insert(categoryTranslations)
              .values({ categoryId: id, locale: 'km', name: nameKm })
              .onConflictDoUpdate({
                target: [
                  categoryTranslations.categoryId,
                  categoryTranslations.locale,
                ],
                set: { name: nameKm },
              });
          } else {
            await tx
              .delete(categoryTranslations)
              .where(
                and(
                  eq(categoryTranslations.categoryId, id),
                  eq(categoryTranslations.locale, 'km'),
                ),
              );
          }
        }

        const [cat] = await tx
          .select()
          .from(categories)
          .where(eq(categories.id, id))
          .limit(1);
        const [t] = await tx
          .select({ name: categoryTranslations.name })
          .from(categoryTranslations)
          .where(
            and(
              eq(categoryTranslations.categoryId, id),
              eq(categoryTranslations.locale, 'en'),
            ),
          )
          .limit(1);
        const [km] = await tx
          .select({ name: categoryTranslations.name })
          .from(categoryTranslations)
          .where(
            and(
              eq(categoryTranslations.categoryId, id),
              eq(categoryTranslations.locale, 'km'),
            ),
          )
          .limit(1);
        return {
          ...cat,
          name: t?.name ?? cat.slug,
          nameKm: km?.name ?? null,
        };
      });
      // After the row commits, delete the now-orphaned previous icon
      // (only when icon was changed or cleared by this update).
      if (dto.icon !== undefined && oldIcon && dto.icon !== oldIcon) {
        await this.files.removeByPublicUrl(oldIcon);
      }
      return result;
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('A category with this slug already exists');
      }
      throw err;
    }
  }

  async remove(id: string): Promise<{ id: string }> {
    const [existing] = await this.db
      .select({ icon: categories.icon })
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Category not found');

    // Subcategories cascade-delete with the category — gather their icons too
    // so none are orphaned in storage.
    const subs = await this.db
      .select({ icon: subcategories.icon })
      .from(subcategories)
      .where(eq(subcategories.categoryId, id));

    // FK cascades delete translations + subcategories (+ their translations).
    await this.db.delete(categories).where(eq(categories.id, id));

    const orphaned = [existing.icon, ...subs.map((s) => s.icon)].filter(
      (u): u is string => !!u,
    );
    await Promise.all(orphaned.map((u) => this.files.removeByPublicUrl(u)));
    return { id };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    );
  }
}
