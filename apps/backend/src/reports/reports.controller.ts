import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { UserReportsService } from './reports.service';
import {
  CreateListingReportDto,
  CreateUserReportDto,
  ListReasonsQueryDto,
} from './dto/create-report.dto';

const REPORT_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('reports')
@Controller('reports')
export class UserReportsController {
  constructor(private readonly service: UserReportsService) {}

  @Get('reasons')
  @Public()
  @ApiOperation({ summary: 'Active report reasons for a target type' })
  reasons(@Query() query: ListReasonsQueryDto) {
    return this.service.listReasons(query.targetType);
  }

  @Post('listings')
  @ApiBearerAuth()
  @Throttle(REPORT_LIMIT)
  @ApiOperation({ summary: 'Report a listing (one open report per listing)' })
  reportListing(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateListingReportDto,
  ) {
    return this.service.reportListing(user.id, dto);
  }

  @Post('users')
  @ApiBearerAuth()
  @Throttle(REPORT_LIMIT)
  @ApiOperation({ summary: 'Report an account (one open report per account)' })
  reportUser(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateUserReportDto,
  ) {
    return this.service.reportUser(user.id, dto);
  }
}
