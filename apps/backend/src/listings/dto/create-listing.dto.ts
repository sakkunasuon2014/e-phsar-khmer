import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ListingPhotoDto } from './listing-photo.dto';

export class CreateListingDto {
  @ApiProperty()
  @IsUUID()
  categoryId: string;

  @ApiProperty()
  @IsUUID()
  subcategoryId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discountValue?: number;

  @ApiPropertyOptional({ enum: ['percent', 'amount'] })
  @IsOptional()
  @IsIn(['percent', 'amount'])
  discountType?: 'percent' | 'amount';

  @ApiPropertyOptional({ enum: ['new', 'used'] })
  @IsOptional()
  @IsIn(['new', 'used'])
  condition?: 'new' | 'used';

  @ApiPropertyOptional({ type: [ListingPhotoDto], maxItems: 8 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ListingPhotoDto)
  photos?: ListingPhotoDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  districtId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  communeId?: string;

  /**
   * The trusted product-spec page this ad links to (a `models` id). Validated
   * by the service against a *published* spec page; null clears it on update.
   * The phones form makes it required — the API keeps it optional like every
   * other per-form rule.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productModelId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  deliveryFree?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ maxItems: 3 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  contactPhones?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}
