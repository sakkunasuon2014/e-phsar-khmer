import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const REPORT_MAX_IMAGES = 6;

export class ListReasonsQueryDto {
  @IsIn(['user', 'listing'])
  targetType: 'user' | 'listing';
}

export class CreateListingReportDto {
  @IsUUID()
  listingId: string;

  @IsUUID()
  reasonId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateUserReportDto {
  @IsUUID()
  targetUserId: string;

  @IsUUID()
  reasonId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Storage paths from `/files/sign` with scope `report` (the caller's own). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REPORT_MAX_IMAGES)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  imagePaths?: string[];
}
