import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** One label/value row of a product spec section. */
export class ProductSpecItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  value: string;
}

/** A named section ("Display", "Camera", …) holding one or more rows. */
export class ProductSpecGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductSpecItemDto)
  rows: ProductSpecItemDto[];
}
