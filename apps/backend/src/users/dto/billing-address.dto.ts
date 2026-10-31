import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export const BILLING_ADDRESS_CATEGORIES = ['home', 'work', 'other'] as const;
export type BillingAddressCategory =
  (typeof BILLING_ADDRESS_CATEGORIES)[number];

export class CreateBillingAddressDto {
  @ApiProperty({ example: 'Home', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label: string;

  @ApiProperty({ enum: BILLING_ADDRESS_CATEGORIES })
  @IsIn(BILLING_ADDRESS_CATEGORIES)
  category: BillingAddressCategory;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({ maxLength: 254 })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  /**
   * A contact number, not a login identifier — deliberately looser than
   * `AddPhoneDto`, which rejects the local `0`-prefixed form this form takes.
   */
  @ApiProperty({ example: '0963766181', maxLength: 32 })
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  phone: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  address: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  taxId?: string;

  @ApiPropertyOptional({ description: 'At most one default per account.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateBillingAddressDto extends PartialType(
  CreateBillingAddressDto,
) {}
