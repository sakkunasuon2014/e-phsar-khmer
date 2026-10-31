import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { advertisementPlacementEnum } from '../../db/schema/advertisements.schema';

/** Must live under the staff-only `advertisement/` sign scope. */
export const ADVERTISEMENT_PATH_RE = /^advertisement\/[\w./-]+$/;

export class CreateAdvertisementDto {
  @IsEnum(advertisementPlacementEnum.enumValues)
  placement: (typeof advertisementPlacementEnum.enumValues)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(ADVERTISEMENT_PATH_RE, {
    message: 'imagePath must be an advertisement/ storage path',
  })
  imagePath: string;

  /** Optional click-through. Relative site paths are allowed as well as URLs. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  linkUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAdvertisementDto {
  @IsOptional()
  @IsEnum(advertisementPlacementEnum.enumValues)
  placement?: (typeof advertisementPlacementEnum.enumValues)[number];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(ADVERTISEMENT_PATH_RE, {
    message: 'imagePath must be an advertisement/ storage path',
  })
  imagePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  linkUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryAdvertisementsDto {
  @IsOptional()
  @IsEnum(advertisementPlacementEnum.enumValues)
  placement?: (typeof advertisementPlacementEnum.enumValues)[number];
}
