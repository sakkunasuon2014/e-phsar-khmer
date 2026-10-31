import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { AdminListingsService } from './admin-listings.service';
import {
  ListAdminListingsDto,
  ModerateListingDto,
} from './dto/list-admin-listings.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/listings')
export class AdminListingsController {
  constructor(private readonly service: AdminListingsService) {}

  @Get()
  @ApiOperation({ summary: 'List every listing, any status (offset paged)' })
  list(@Query() query: ListAdminListingsDto) {
    return this.service.list(query);
  }

  @Post(':id/remove')
  @ApiOperation({
    summary:
      'Take a listing down (hidden everywhere; the owner cannot republish)',
  })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateListingDto,
  ) {
    return this.service.remove(id, user.id, dto.reason);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Undo a take-down' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.restore(id);
  }
}
