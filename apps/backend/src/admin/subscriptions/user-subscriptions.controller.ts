import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserSubscriptionsService } from './user-subscriptions.service';
import { GrantSubscriptionDto } from './dto/grant-subscription.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/user-subscriptions')
export class UserSubscriptionsController {
  constructor(private readonly service: UserSubscriptionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List current user subscriptions; history=true adds superseded rows',
  })
  list(
    @Query('history', new ParseBoolPipe({ optional: true })) history?: boolean,
  ) {
    return this.service.list(history ?? false);
  }

  @Post()
  @ApiOperation({ summary: 'Grant a subscription to a user (user + term)' })
  grant(@Body() dto: GrantSubscriptionDto) {
    return this.service.grant(dto);
  }

  @Post(':id/revoke')
  @ApiOperation({
    summary: 'Revoke a current subscription (kept as history, never deleted)',
  })
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.revoke(id);
  }
}
