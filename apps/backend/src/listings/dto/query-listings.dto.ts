import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  Max,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FEED_SORTS } from '../feed-cursor';
import type { FeedSort } from '../feed-cursor';

export const POSTED_WITHIN = ['today', 'week', 'month'] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number];

/**
 * Query-string boolean: only the literal `true`/`"true"` is true. The global
 * pipe's implicit conversion would turn the string "false" into `true`
 * (`Boolean("false")`), so read the raw value instead.
 */
const QueryBoolean = () =>
  Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    return raw === true || raw === 'true';
  });

export class QueryListingsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subcategorySlug?: string;

  @ApiPropertyOptional({
    description:
      'Keyword search: whitespace-split (max 5 tokens), every token must ' +
      'appear in the title or description (case-insensitive substring).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Bound on the final (discounted) price, effective_price. Listings ' +
      'with no price ("Negotiable") are excluded while a bound is set.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minPrice?: number;

  @ApiPropertyOptional({
    description:
      'Bound on the final (discounted) price, effective_price. Listings ' +
      'with no price ("Negotiable") are excluded while a bound is set.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: ['new', 'used'] })
  @IsOptional()
  @IsIn(['new', 'used'])
  condition?: 'new' | 'used';

  @ApiPropertyOptional({ description: 'Only honoured on /listings/me/all' })
  @IsOptional()
  @IsIn(['draft', 'active', 'expired', 'deleted', 'restricted'])
  status?: string;

  /**
   * One seller's ads — the public profile's post history.
   *
   * Feed-only, and deliberately NOT a substitute for `/listings/me/all`:
   * `findMine` is scoped to the caller's own JWT and does not filter by
   * status, so it must never back a page anyone can open. This one rides the
   * feed, which always ANDs `status = 'active'` — a draft, an expired ad or a
   * soft-deleted one stays invisible no matter what the caller sends.
   */
  @ApiPropertyOptional({
    description:
      'Only the active listings owned by this user (the public profile feed)',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by province slug' })
  @IsOptional()
  @IsString()
  provinceSlug?: string;

  @ApiPropertyOptional({
    description: 'Filter by district slug (requires provinceSlug)',
  })
  @IsOptional()
  @IsString()
  districtSlug?: string;

  @ApiPropertyOptional({
    description: 'Filter by commune slug (requires districtSlug)',
  })
  @IsOptional()
  @IsString()
  communeSlug?: string;

  @ApiPropertyOptional({
    description:
      "Min model year — listings.attributes->>'year' (non-numeric years never match)",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  yearMin?: number;

  @ApiPropertyOptional({ description: 'Max model year (see yearMin)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  yearMax?: number;

  @ApiPropertyOptional({
    description:
      "Engine type display name — listings.attributes->>'engineType' (e.g. Petrol)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  engineType?: string;

  @ApiPropertyOptional({
    enum: FEED_SORTS,
    default: 'newest',
    description:
      'relevance = best match for q (falls back to newest without q)',
  })
  @IsOptional()
  @IsIn(FEED_SORTS)
  sort?: FeedSort;

  @ApiPropertyOptional({
    enum: POSTED_WITHIN,
    description:
      'today = since 00:00 Asia/Phnom_Penh; week = last 7 days; month = last 30 days',
  })
  @IsOptional()
  @IsIn(POSTED_WITHIN)
  postedWithin?: PostedWithin;

  @ApiPropertyOptional({ description: 'Only listings with free delivery' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  deliveryFree?: boolean;

  @ApiPropertyOptional({
    description:
      'Only listings with a discount (discount_value > 0 and discount_type set)',
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  hasDiscount?: boolean;

  @ApiPropertyOptional({ description: 'Add meta.total (feed only)' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeTotal?: boolean;

  @ApiPropertyOptional({
    description:
      'Add meta.facets: per-category counts (and per-subcategory counts ' +
      'once a category is selected) for the current filters (feed only)',
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeFacets?: boolean;

  @ApiPropertyOptional({
    description: "Filter by the ad's brand (listings.attributes->>'brand')",
  })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({
    description:
      "Filter by the ad's body type (listings.attributes->>'bodyType')",
  })
  @IsOptional()
  @IsString()
  bodyType?: string;

  /**
   * The remaining per-attribute filters the browse dialog offers. Each one
   * reads the same value the post form wrote into `attributes`, so they are
   * plain equality params like `brand`/`bodyType` — no JSONB path comes from
   * the caller, and every param is additive (an old client that never sends
   * them behaves exactly as before).
   */
  @ApiPropertyOptional({
    description: "Filter by the ad's model (listings.attributes->>'model')",
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: "Filter by tax type (listings.attributes->>'taxType')",
  })
  @IsOptional()
  @IsString()
  taxType?: string;

  @ApiPropertyOptional({
    description: "Filter by colour (listings.attributes->>'color')",
  })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({
    description:
      "Filter by transmission (listings.attributes->>'transmission')",
  })
  @IsOptional()
  @IsString()
  transmission?: string;

  /**
   * Generic sibling of `brand`/`bodyType` for every OTHER attribute grid.
   *
   * Those two are only correct for the one family whose listings store those
   * exact keys. The browse pages render a grid per linked attribute set, and
   * the key a set's value lands under is the subcategory's own `field_schema`
   * key — `type` for House For Sale, `vehicleType` for Vehicles For Rent (from
   * the same `bodytypes` set that cars store as `bodyType`), `accessory`,
   * `network`, `jobType`, … So the web resolves the key and sends it here
   * rather than the backend guessing. Additive: both params are optional and
   * `brand`/`bodyType` behave exactly as before.
   */
  @ApiPropertyOptional({
    description:
      'Attribute key to filter on, e.g. `type` (listings.attributes->>attrKey). ' +
      'Requires attrValue; ignored on its own.',
  })
  @IsOptional()
  @Matches(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/, {
    message: 'attrKey must be a plain attribute key (letters/digits)',
  })
  attrKey?: string;

  @ApiPropertyOptional({
    description: 'Value for attrKey — the display name the post form wrote.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  attrValue?: string;

  @ApiPropertyOptional({
    description:
      'Multiple attribute filters as a JSON object, e.g. ' +
      '`{"storage":"128GB","ram":"8GB"}` (the More Filters dialog). Every ' +
      'entry is AND-ed against `listings.attributes`; keys must be plain ' +
      'attribute keys and values the display strings the post form wrote. ' +
      'Malformed input applies nothing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attrs?: string;
}
