import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── Categories ──────────────────────────────────────────────
export class CreateSubCategoryDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @Matches(SLUG_RE, { message: 'slug must be lowercase-hyphenated' })
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSubCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @Matches(SLUG_RE) slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Packages (a group's fixed tier and its limits) ─────────
export class CreateSubPackageDto {
  @IsUUID() categoryId: string;
  @IsEnum(['bronze', 'silver', 'gold']) tier: 'bronze' | 'silver' | 'gold';
  @IsOptional() @IsInt() @Min(0) photos?: number;
  @IsOptional() @IsInt() @Min(0) ads?: number;
  @IsOptional() @IsInt() @Min(0) renews?: number;
  @IsOptional() @IsInt() @Min(0) autoRenews?: number;
  @IsOptional() @IsInt() @Min(0) videos?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSubPackageDto {
  @IsOptional()
  @IsEnum(['bronze', 'silver', 'gold'])
  tier?: 'bronze' | 'silver' | 'gold';
  @IsOptional() @IsInt() @Min(0) photos?: number;
  @IsOptional() @IsInt() @Min(0) ads?: number;
  @IsOptional() @IsInt() @Min(0) renews?: number;
  @IsOptional() @IsInt() @Min(0) autoRenews?: number;
  @IsOptional() @IsInt() @Min(0) videos?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Terms (fixed 3/6/12-month durations) ───────────────────
export class CreateSubTermDto {
  @IsUUID() packageId: string;
  @IsIn([3, 6, 12]) durationMonths: number;
  @IsNumber() @Min(0) price: number;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsEnum(['percent', 'amount']) discountType?:
    | 'percent'
    | 'amount';
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSubTermDto {
  @IsOptional() @IsIn([3, 6, 12]) durationMonths?: number;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsEnum(['percent', 'amount']) discountType?:
    | 'percent'
    | 'amount';
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Group scope ─────────────────────────────────────────────
/** Replaces the whole set of listing subcategories a group covers. */
export class UpdateSubCategoryScopeDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  subcategoryIds: string[];
}

// ── Free plan ───────────────────────────────────────────────
export class FreePlanAdLimitDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() subcategoryId?: string;
  @IsInt() @Min(0) ads: number;
}

/** Replaces the free plan: its account-wide numbers and every ad cap. */
export class UpdateFreePlanDto {
  @IsInt() @Min(0) photos: number;
  @IsInt() @Min(0) renews: number;
  @IsInt() @Min(0) autoRenews: number;
  @IsInt() @Min(0) videos: number;
  @IsInt() @Min(0) otherAds: number;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => FreePlanAdLimitDto)
  adLimits: FreePlanAdLimitDto[];
}
