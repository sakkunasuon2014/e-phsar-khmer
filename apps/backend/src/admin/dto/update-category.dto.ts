import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Matches(SLUG_RE, {
    message: 'slug must be lowercase with hyphens only (e.g. my-category)',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** Khmer display name. An empty string or null clears an existing translation. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameKm?: string | null;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
