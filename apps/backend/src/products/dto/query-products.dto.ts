import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PRODUCT_SPEC_FAMILIES } from '../../db/schema/products.schema';
import type { ProductSpecFamily } from '../../db/schema/products.schema';

export class QueryProductsDto {
  /** Free-text search over brand + model names/slugs. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Only pages of this family (the post form's scoped picker). */
  @IsOptional()
  @IsIn([...PRODUCT_SPEC_FAMILIES])
  family?: ProductSpecFamily;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
