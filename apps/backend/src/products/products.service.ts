import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import {
  brands,
  modelSubcategoryLinks,
  models,
} from '../db/schema/brands.schema';
import { subcategories } from '../db/schema/categories.schema';
import { productSpecs } from '../db/schema/products.schema';
import type {
  NewProductSpec,
  ProductSpecFamily,
  ProductSpecGroup,
} from '../db/schema/products.schema';
import { likeTerm } from '../utils/like-term';
import type { CreateProductDto } from './dto/create-product.dto';
import type { QueryProductsDto } from './dto/query-products.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import {
  getFamilyForSubcategorySlug,
  getProductSpecTemplate,
  groupSignature,
  isTemplateGroup,
} from './spec-templates';
import type { ProductSpecTemplate } from './spec-templates';

/** Mirrors the listing keyword search's cap — enough words, bounded work. */
const MAX_SEARCH_TOKENS = 5;

/** What a listing detail embeds: just enough to render the specs link. */
export interface ProductRef {
  modelId: string;
  brandSlug: string;
  brandName: string;
  modelSlug: string;
  modelName: string;
}

/** Search result / picker row. */
export interface PublicProductSummary extends ProductRef {
  id: string;
  brandId: string;
  image: string | null;
}

/** Full public spec page. */
export interface PublicProduct extends PublicProductSummary {
  family: ProductSpecFamily;
  /** The staff-uploaded image (raw); empty when the model image is used. */
  specImage: string | null;
  specGroups: ProductSpecGroup[];
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Admin rows carry the same shape as the public page (plus drafts). */
export type AdminProduct = PublicProduct;

const detailFields = {
  id: productSpecs.id,
  modelId: productSpecs.modelId,
  family: productSpecs.family,
  brandId: brands.id,
  brandSlug: brands.slug,
  brandName: brands.name,
  modelSlug: models.slug,
  modelName: models.name,
  // The product page's own image wins; the model image is the fallback.
  image: sql<string | null>`coalesce(${productSpecs.image}, ${models.image})`,
  specImage: productSpecs.image,
  specGroups: productSpecs.specGroups,
  isPublished: productSpecs.isPublished,
  createdAt: productSpecs.createdAt,
  updatedAt: productSpecs.updatedAt,
};

@Injectable()
export class ProductsService {
  constructor(@Inject(DRIZZLE) private readonly db: DbClient) {}

  /**
   * A page is visible to the public (and attachable from the post form) only
   * when the spec is published AND both catalogue rows are active — an
   * unpublished page must not leak through a direct URL, and a deactivated
   * brand/model must disappear from search instead of advertising itself.
   */
  private visibility(): SQL[] {
    return [
      eq(productSpecs.isPublished, true),
      eq(models.isActive, true),
      eq(brands.isActive, true),
    ];
  }

  async listPublished(
    query: QueryProductsDto = {},
  ): Promise<PublicProductSummary[]> {
    const conditions = this.visibility();
    if (query.family) {
      conditions.push(eq(productSpecs.family, query.family));
    }
    const q = query.q?.trim();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
      for (const token of tokens) {
        const term = likeTerm(token);
        conditions.push(
          or(
            ilike(brands.name, term),
            ilike(brands.slug, term),
            ilike(models.name, term),
            ilike(models.slug, term),
          )!,
        );
      }
    }

    return this.db
      .select({
        id: productSpecs.id,
        modelId: productSpecs.modelId,
        brandId: brands.id,
        brandSlug: brands.slug,
        brandName: brands.name,
        modelSlug: models.slug,
        modelName: models.name,
        image: sql<
          string | null
        >`coalesce(${productSpecs.image}, ${models.image})`,
      })
      .from(productSpecs)
      .innerJoin(models, eq(models.id, productSpecs.modelId))
      .innerJoin(brands, eq(brands.id, models.brandId))
      .where(and(...conditions))
      .orderBy(asc(brands.name), asc(models.sortOrder), asc(models.name))
      .limit(query.limit ?? 10);
  }

  async getPublishedBySlug(
    brandSlug: string,
    modelSlug: string,
  ): Promise<PublicProduct> {
    const [row] = await this.db
      .select(detailFields)
      .from(productSpecs)
      .innerJoin(models, eq(models.id, productSpecs.modelId))
      .innerJoin(brands, eq(brands.id, models.brandId))
      .where(
        and(
          eq(brands.slug, brandSlug),
          eq(models.slug, modelSlug),
          ...this.visibility(),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Product not found');
    return row;
  }

  async listAdmin(family?: ProductSpecFamily): Promise<AdminProduct[]> {
    return this.db
      .select(detailFields)
      .from(productSpecs)
      .innerJoin(models, eq(models.id, productSpecs.modelId))
      .innerJoin(brands, eq(brands.id, models.brandId))
      .where(family ? eq(productSpecs.family, family) : undefined)
      .orderBy(asc(brands.name), asc(models.sortOrder), asc(models.name));
  }

  async createAdmin(dto: CreateProductDto): Promise<AdminProduct> {
    const template = getProductSpecTemplate(dto.family);
    const specGroups = this.normalizeGroups(dto.specGroups);
    this.assertTemplateGroups(template, specGroups, []);
    await this.assertModelInFamily(dto.modelId, template);

    let id: string;
    try {
      const [row] = await this.db
        .insert(productSpecs)
        .values({
          modelId: dto.modelId,
          family: dto.family,
          image: dto.image?.trim() || null,
          specGroups,
          isPublished: dto.isPublished ?? true,
        })
        .returning({ id: productSpecs.id });
      id = row.id;
    } catch (err) {
      this.mapWriteError(err);
    }
    return this.getAdminOne(id!);
  }

  async updateAdmin(id: string, dto: UpdateProductDto): Promise<AdminProduct> {
    const [existing] = await this.db
      .select({
        id: productSpecs.id,
        family: productSpecs.family,
        specGroups: productSpecs.specGroups,
      })
      .from(productSpecs)
      .where(eq(productSpecs.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Product spec not found');

    const patch: Partial<NewProductSpec> = {};
    if (dto.specGroups !== undefined) {
      const specGroups = this.normalizeGroups(dto.specGroups);
      this.assertTemplateGroups(
        getProductSpecTemplate(existing.family),
        specGroups,
        existing.specGroups,
      );
      patch.specGroups = specGroups;
    }
    if (dto.image !== undefined) {
      patch.image = dto.image.trim() || null;
    }
    if (dto.isPublished !== undefined) patch.isPublished = dto.isPublished;

    if (Object.keys(patch).length > 0) {
      await this.db
        .update(productSpecs)
        .set(patch)
        .where(eq(productSpecs.id, id));
    }
    return this.getAdminOne(id);
  }

  /** The family template the admin form renders (static, code-owned). */
  getTemplate(family: string): ProductSpecTemplate {
    return getProductSpecTemplate(family as ProductSpecFamily);
  }

  async removeAdmin(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .delete(productSpecs)
      .where(eq(productSpecs.id, id))
      .returning({ id: productSpecs.id });
    if (!row) throw new NotFoundException('Product spec not found');
    return row;
  }

  /**
   * Listing create/update gate: a listing may only point at a page the public
   * can actually open. Called before the write; see the TOCTOU note in the
   * plan (a publish flip in between hides the link, never corrupts the row).
   */
  async assertPublishedModel(
    modelId: string,
    subcategoryId?: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: productSpecs.id, family: productSpecs.family })
      .from(productSpecs)
      .innerJoin(models, eq(models.id, productSpecs.modelId))
      .innerJoin(brands, eq(brands.id, models.brandId))
      .where(and(eq(productSpecs.modelId, modelId), ...this.visibility()))
      .limit(1);
    if (!row) {
      throw new BadRequestException(
        'productModelId must reference a published product spec',
      );
    }
    if (!subcategoryId) return;

    const [subcategory] = await this.db
      .select({ slug: subcategories.slug })
      .from(subcategories)
      .where(eq(subcategories.id, subcategoryId))
      .limit(1);
    if (!subcategory) return;

    const family = getFamilyForSubcategorySlug(subcategory.slug);
    if (family && row.family !== family) {
      throw new BadRequestException(
        'productModelId must reference a spec page from the same family as the listing subcategory',
      );
    }
  }

  /** Detail-page embed: null when unlinked, unpublished or catalogue-inactive. */
  async getPublishedRefByModelId(modelId: string): Promise<ProductRef | null> {
    const [row] = await this.db
      .select({
        modelId: productSpecs.modelId,
        brandSlug: brands.slug,
        brandName: brands.name,
        modelSlug: models.slug,
        modelName: models.name,
      })
      .from(productSpecs)
      .innerJoin(models, eq(models.id, productSpecs.modelId))
      .innerJoin(brands, eq(brands.id, models.brandId))
      .where(and(eq(productSpecs.modelId, modelId), ...this.visibility()))
      .limit(1);
    return row ?? null;
  }

  private async getAdminOne(id: string): Promise<AdminProduct> {
    const [row] = await this.db
      .select(detailFields)
      .from(productSpecs)
      .innerJoin(models, eq(models.id, productSpecs.modelId))
      .innerJoin(brands, eq(brands.id, models.brandId))
      .where(eq(productSpecs.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Product spec not found');
    return row;
  }

  private normalizeGroups(groups: ProductSpecGroup[]): ProductSpecGroup[] {
    const normalized = groups.map((group) => ({
      title: group.title.trim(),
      rows: group.rows.map((row) => ({
        label: row.label.trim(),
        value: row.value.trim(),
      })),
    }));
    const hasEmpty = normalized.some(
      (group) =>
        !group.title || group.rows.some((row) => !row.label || !row.value),
    );
    if (hasEmpty) {
      throw new BadRequestException(
        'Spec titles, labels and values cannot be empty',
      );
    }
    return normalized;
  }

  /**
   * New groups must be template sections. An update may also keep groups
   * already stored on the row (grandfathered legacy content), matched by the
   * exact title + label signature so a legacy section can never be silently
   * rewritten into a template one.
   */
  private assertTemplateGroups(
    template: ProductSpecTemplate,
    groups: ProductSpecGroup[],
    legacy: ProductSpecGroup[],
  ): void {
    // Freeform families (Cars, Motorcycles) accept any group/row.
    if (template.mode === 'freeform') return;

    const legacySignatures = new Set(legacy.map(groupSignature));
    const templateTitles = new Set<string>();
    for (const group of groups) {
      if (isTemplateGroup(template.family, group)) {
        if (templateTitles.has(group.title)) {
          throw new BadRequestException('INVALID_SPEC_SECTION');
        }
        templateTitles.add(group.title);
        continue;
      }
      if (legacySignatures.has(groupSignature(group))) continue;
      throw new BadRequestException('INVALID_SPEC_SECTION');
    }
  }

  /** The model must belong to the family's listing subcategory. */
  private async assertModelInFamily(
    modelId: string,
    template: ProductSpecTemplate,
  ): Promise<void> {
    const [link] = await this.db
      .select({ modelId: modelSubcategoryLinks.modelId })
      .from(modelSubcategoryLinks)
      .innerJoin(
        subcategories,
        eq(subcategories.id, modelSubcategoryLinks.subcategoryId),
      )
      .where(
        and(
          eq(modelSubcategoryLinks.modelId, modelId),
          eq(subcategories.slug, template.subcategorySlug),
        ),
      )
      .limit(1);
    if (!link) {
      throw new BadRequestException(
        `Model is not linked to the ${template.label} category`,
      );
    }
  }

  /** Drizzle surfaces the pg error code; map the two we can act on. */
  private mapWriteError(err: unknown): never {
    if (err instanceof HttpException) throw err;
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      throw new ConflictException(
        'A product spec already exists for this model',
      );
    }
    if (code === '23503') {
      throw new BadRequestException('modelId does not exist');
    }
    throw err;
  }
}
