import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { Public } from '../common/decorators/public.decorator';
import { CreateSubscriptionCheckoutDto } from './dto/create-subscription-checkout.dto';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Public()
  @Get('catalog')
  catalog() {
    return this.subscriptions.catalog();
  }

  @Public()
  @Get('free-plan')
  @ApiOperation({
    summary:
      'What every account gets without a subscription: limits and per-category ad caps',
  })
  freePlan() {
    return this.entitlements.freePlan();
  }

  @Get('me')
  @ApiBearerAuth()
  mine(@CurrentUser() user: RequestUser) {
    return this.subscriptions.mine(user.id);
  }

  @Get('entitlements')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "The caller's allowance buckets and usage; with subcategoryId, `limits`/`usage` are that subcategory's bucket",
  })
  @ApiQuery({ name: 'subcategoryId', required: false })
  myEntitlements(
    @CurrentUser() user: RequestUser,
    @Query('subcategoryId', new ParseUUIDPipe({ optional: true }))
    subcategoryId?: string,
  ) {
    return this.entitlements.view(user.id, subcategoryId);
  }

  @Post('checkout')
  @ApiBearerAuth()
  checkout(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSubscriptionCheckoutDto,
  ) {
    return this.subscriptions.checkout(user.id, dto);
  }
}
