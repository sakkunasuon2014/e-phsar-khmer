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
import { ConfigService } from '@nestjs/config';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { ChatMetricsService } from '../chat/chat-metrics.service';
import { AdminService } from './admin.service';
import { ListUsersDto } from './dto/list-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { TimeseriesQueryDto } from './dto/timeseries-query.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@UseGuards(RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly chatMetrics: ChatMetricsService,
    private readonly configService: ConfigService,
  ) {}

  @Get('chat-metrics')
  @ApiOperation({
    summary:
      'In-process chat send-latency snapshot (this instance only, resets on restart) — for spot-checking "is chat slow right now" without a live investigation.',
  })
  getChatMetrics() {
    return {
      ...this.chatMetrics.snapshot(),
      dbPoolMax: this.configService.get<number>('database.poolMax'),
    };
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Dashboard KPI counters with period-over-period deltas',
  })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('stats/timeseries')
  @ApiOperation({ summary: 'Daily new users + new listings over a date range' })
  getTimeseries(@Query() query: TimeseriesQueryDto) {
    return this.adminService.getTimeseries(query.range);
  }

  @Get('users')
  @ApiOperation({ summary: 'List users (offset paginated, filterable)' })
  listUsers(@Query() query: ListUsersDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get a single user by ID' })
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a user or admin (with password)' })
  createUser(
    @CurrentUser() requester: RequestUser,
    @Body() dto: CreateUserDto,
  ) {
    return this.adminService.createUser(dto, requester);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update a user (role/status/profile/password)' })
  updateUser(
    @CurrentUser() requester: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto, requester);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Soft-delete a user' })
  deleteUser(
    @CurrentUser() requester: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.deleteUser(id, requester);
  }
}
