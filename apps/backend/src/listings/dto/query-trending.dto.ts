import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  TRENDING_LIMIT,
  TRENDING_LIMIT_MAX,
  TRENDING_WINDOW_DAYS,
  TRENDING_WINDOW_DAYS_MAX,
} from '../trending';

export class QueryTrendingDto {
  @ApiPropertyOptional({
    default: TRENDING_LIMIT,
    minimum: 1,
    maximum: TRENDING_LIMIT_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TRENDING_LIMIT_MAX)
  @Type(() => Number)
  limit?: number = TRENDING_LIMIT;

  @ApiPropertyOptional({
    default: TRENDING_WINDOW_DAYS,
    minimum: 1,
    maximum: TRENDING_WINDOW_DAYS_MAX,
    description: 'Rolling engagement window, in days',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TRENDING_WINDOW_DAYS_MAX)
  @Type(() => Number)
  windowDays?: number = TRENDING_WINDOW_DAYS;
}
