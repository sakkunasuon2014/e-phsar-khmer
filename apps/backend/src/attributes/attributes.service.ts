import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import { attributeOptions } from '../db/schema/attributes.schema';
import type { AttributeOptionRow } from '../db/schema/attributes.schema';
import { categories, subcategories } from '../db/schema/categories.schema';
import type { CreateAttributeDto } from './dto/create-attribute.dto';
import type { UpdateAttributeDto } from './dto/update-attribute.dto';
import { FilesService } from '../files/files.service';

const YEAR_MIN = 1980;
const YEAR_CATEGORY_SLUG = 'cars-and-vehicles';
const YEAR_SUB_SLUGS = ['cars-for-sale', 'motorcycles-for-sale'] as const;

@Injectable()
export class AttributesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly files: FilesService,
  ) {}

  list(type: string): Promise<AttributeOptionRow[]> {
    if (type === 'years') return this.listYears();
    return this.db
      .select()
      .from(attributeOptions)
      .where(eq(attributeOptions.type, type))
      .orderBy(asc(attributeOptions.sortOrder));
  }

  /**
   * Every attribute row linked to a subcategory (the denormalized
   * `subcategoryIds` mirror). The web browse pages fetch this once instead
   * of one call per attribute type — the per-type endpoints stay for the
   * admin pages. Rows are ordered by type then sortOrder.
   */
  listBySubcategory(subcategoryId: string): Promise<AttributeOptionRow[]> {
    return this.db
      .select()
      .from(attributeOptions)
      .where(
        sql`${attributeOptions.subcategoryIds} @> ${JSON.stringify([
          subcategoryId,
        ])}::jsonb`,
      )
      .orderBy(asc(attributeOptions.type), asc(attributeOptions.sortOrder));
  }

  /**
   * Years are generated deterministically (current year + 1 → YEAR_MIN) and
   * are never stored in `attribute_options`. `id` is a display-only fake —
   * writes for `years` are rejected, so it never reaches the API. Rows are
   * returned newest-first; the category/subcategory link is resolved at read
   * time (falls back to null/[] if the cars category is not seeded yet).
   */
  private async listYears(): Promise<AttributeOptionRow[]> {
    const currentYear = new Date().getFullYear();

    const [carCategory, subRows] = await Promise.all([
      this.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, YEAR_CATEGORY_SLUG))
        .limit(1),
      this.db
        .select({ id: subcategories.id })
        .from(subcategories)
        .where(inArray(subcategories.slug, [...YEAR_SUB_SLUGS])),
    ]);

    const categoryId = carCategory[0]?.id ?? null;
    const subIds = subRows.map((r) => r.id);
    const now = new Date();

    const rows: AttributeOptionRow[] = [];
    for (let y = currentYear + 1; y >= YEAR_MIN; y--) {
      rows.push({
        id: `year-${y}`,
        type: 'years',
        slug: String(y),
        name: String(y),
        nameKm: null,
        image: null,
        categoryId,
        subcategoryIds: categoryId ? subIds : [],
        sortOrder: y - YEAR_MIN,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    return rows;
  }

  async create(
    type: string,
    dto: CreateAttributeDto,
  ): Promise<AttributeOptionRow> {
    if (type === 'years') {
      throw new BadRequestException(
        'Years are generated automatically and cannot be modified',
      );
    }
    try {
      const [row] = await this.db
        .insert(attributeOptions)
        .values({
          type,
          name: dto.name,
          nameKm: dto.nameKm?.trim() || null,
          slug: dto.slug,
          image: dto.image ?? null,
          categoryId: dto.categoryId ?? null,
          subcategoryIds: dto.subcategoryIds ?? [],
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        })
        .returning();
      return row;
    } catch (err) {
      this.rethrow(err);
    }
  }

  async update(
    type: string,
    id: string,
    dto: UpdateAttributeDto,
  ): Promise<AttributeOptionRow> {
    if (type === 'years') {
      throw new BadRequestException(
        'Years are generated automatically and cannot be modified',
      );
    }
    const patch: Partial<AttributeOptionRow> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    // `nameKm: null` is how a client clears the Khmer name (the web action
    // sends `input.nameKm || null`), and @IsOptional lets null through — the
    // optional chain is load-bearing, not defensive noise.
    if (dto.nameKm !== undefined) patch.nameKm = dto.nameKm?.trim() || null;
    if (dto.slug !== undefined) patch.slug = dto.slug;
    if (dto.image !== undefined) patch.image = dto.image;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.subcategoryIds !== undefined)
      patch.subcategoryIds = dto.subcategoryIds;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    const where = and(
      eq(attributeOptions.id, id),
      eq(attributeOptions.type, type),
    );

    try {
      const [prior] = await this.db
        .select({ image: attributeOptions.image })
        .from(attributeOptions)
        .where(where)
        .limit(1);
      const oldImage = prior?.image ?? null;

      const rows =
        Object.keys(patch).length > 0
          ? await this.db
              .update(attributeOptions)
              .set(patch)
              .where(where)
              .returning()
          : await this.db.select().from(attributeOptions).where(where);
      if (rows.length === 0) throw new NotFoundException('Attribute not found');

      if (dto.image !== undefined && oldImage && dto.image !== oldImage) {
        await this.files.removeByPublicUrl(oldImage);
      }
      return rows[0];
    } catch (err) {
      this.rethrow(err);
    }
  }

  async remove(type: string, id: string): Promise<{ id: string }> {
    if (type === 'years') {
      throw new BadRequestException(
        'Years are generated automatically and cannot be modified',
      );
    }
    const [existing] = await this.db
      .select({ image: attributeOptions.image })
      .from(attributeOptions)
      .where(and(eq(attributeOptions.id, id), eq(attributeOptions.type, type)))
      .limit(1);
    if (!existing) throw new NotFoundException('Attribute not found');

    await this.db.delete(attributeOptions).where(eq(attributeOptions.id, id));
    await this.files.removeByPublicUrl(existing.image);
    return { id };
  }

  private rethrow(err: unknown): never {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === '23505') {
      throw new ConflictException(
        'An option with this slug already exists for that type',
      );
    }
    if (code === '23503') {
      throw new BadRequestException('categoryId does not exist');
    }
    throw err;
  }
}
