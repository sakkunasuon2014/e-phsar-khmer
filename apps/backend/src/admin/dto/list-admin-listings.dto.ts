import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListAdminListingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'expired', 'deleted', 'restricted'])
  status?: 'draft' | 'active' | 'expired' | 'deleted' | 'restricted';

  /** true → only staff-removed ads; false → only ads that were not. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  moderated?: boolean;

  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Category slug (the admin Listings category filter). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  categorySlug?: string;

  /** Subcategory slug, scoped by `categorySlug` when both are present. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subcategorySlug?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number = 20;
}

export class ModerateListingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
