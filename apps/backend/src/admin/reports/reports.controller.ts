import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/api-response.types';
import { ReportsService } from './reports.service';
import {
  CreateReportReasonDto,
  UpdateReportReasonDto,
  UpdateReportStatusDto,
} from './dto/report.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@UseGuards(RolesGuard)
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  // ── Reasons ───────────────────────────────────────────────
  @Get('reasons')
  @ApiOperation({ summary: 'List report reasons (optionally by type)' })
  listReasons(@Query('type') type?: 'user' | 'listing') {
    return this.service.listReasons(type);
  }

  @Post('reasons')
  createReason(@Body() dto: CreateReportReasonDto) {
    return this.service.createReason(dto);
  }

  @Patch('reasons/:id')
  updateReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportReasonDto,
  ) {
    return this.service.updateReason(id, dto);
  }

  @Delete('reasons/:id')
  removeReason(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeReason(id);
  }

  // ── User reports ──────────────────────────────────────────
  @Get('users')
  @ApiOperation({ summary: 'List user reports (joined, with reason text)' })
  listUserReports() {
    return this.service.listUserReports();
  }

  @Patch('users/:id')
  @ApiOperation({
    summary:
      'Update a user report status. Approving suspends the reported account.',
  })
  updateUserReportStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.updateUserReportStatus(id, dto, user);
  }

  @Delete('users/:id')
  removeUserReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeUserReport(id);
  }

  // ── Listing reports ───────────────────────────────────────
  @Get('listings')
  @ApiOperation({ summary: 'List listing reports (joined, with reason text)' })
  listListingReports() {
    return this.service.listListingReports();
  }

  @Patch('listings/:id')
  @ApiOperation({
    summary:
      'Update a listing report status. Approving takes the listing down.',
  })
  updateListingReportStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.updateListingReportStatus(id, dto, user);
  }

  @Delete('listings/:id')
  removeListingReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeListingReport(id);
  }
}
