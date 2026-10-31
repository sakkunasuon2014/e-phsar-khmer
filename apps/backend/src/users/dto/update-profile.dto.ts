import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Every optional field follows one rule: `undefined` leaves the stored value
 * alone, an explicit `null` clears it. Without that, a field could be set from
 * the settings form but never emptied — the location cascade in particular
 * (clearing it sends three nulls).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ enum: ['male', 'female'], nullable: true })
  @IsOptional()
  @IsIn(['male', 'female'])
  gender?: 'male' | 'female' | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO date (YYYY-MM-DD); also keeps `yearOfBirth` in sync.',
    example: '1995-04-17',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;

  // Legacy year-only field; the settings form now sends `dateOfBirth`.
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear())
  @Type(() => Number)
  yearOfBirth?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  company?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  provinceId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  districtId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  communeId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  address?: string | null;

  // `null` clears the pin — the settings map's remove control. The service
  // maps a null to SQL NULL (`String(null)` would write the literal "null").
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsLatitude()
  @Type(() => Number)
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsLongitude()
  @Type(() => Number)
  longitude?: number | null;

  /**
   * Settings-only switch behind "Update this contact to your ads": after the
   * profile write, copy the contact block and location (province/district/
   * commune, address, and the map pin when the profile has one) to every
   * non-deleted listing the user owns. Additive and optional, so existing
   * callers are unaffected.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  updateAdsContact?: boolean;

  @ApiPropertyOptional({ enum: ['en', 'km'] })
  @IsOptional()
  @IsIn(['en', 'km'])
  preferredLanguage?: string;

  /**
   * Settings → Privacy lookup visibility: `true` = Public, `false` = Only Me.
   * Optional like every other field, so a PATCH that flips one toggle leaves
   * the other four untouched.
   */
  @ApiPropertyOptional({ description: 'true = Public, false = Only Me' })
  @IsOptional()
  @IsBoolean()
  discoverableByGender?: boolean;

  @ApiPropertyOptional({ description: 'true = Public, false = Only Me' })
  @IsOptional()
  @IsBoolean()
  discoverableByDateOfBirth?: boolean;

  @ApiPropertyOptional({ description: 'true = Public, false = Only Me' })
  @IsOptional()
  @IsBoolean()
  discoverableByPhone?: boolean;

  @ApiPropertyOptional({ description: 'true = Public, false = Only Me' })
  @IsOptional()
  @IsBoolean()
  discoverableByEmail?: boolean;

  @ApiPropertyOptional({ description: 'true = Public, false = Only Me' })
  @IsOptional()
  @IsBoolean()
  discoverableByLocation?: boolean;
}
