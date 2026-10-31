import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PRODUCT_SPEC_FAMILIES } from '../../db/schema/products.schema';
import type { ProductSpecFamily } from '../../db/schema/products.schema';
import { ProductSpecGroupDto } from './product-spec-group.dto';

export class CreateProductDto {
  /** The existing model row this spec page documents (immutable afterwards). */
  @IsUUID()
  modelId: string;

  /** Which family template the page is built from (immutable afterwards). */
  @IsIn([...PRODUCT_SPEC_FAMILIES])
  family: ProductSpecFamily;

  /** Storage public URL from the staff-only `product` sign scope. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProductSpecGroupDto)
  specGroups: ProductSpecGroupDto[];

  /** Defaults to true — an admin creating a page intends it to be visible. */
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
