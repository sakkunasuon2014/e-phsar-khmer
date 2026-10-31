import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { QueryListingsDto } from './dto/query-listings.dto';
import { QueryTrendingDto } from './dto/query-trending.dto';

@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Browse active listings feed (cursor-based)' })
  getFeed(@Query() query: QueryListingsDto) {
    return this.listingsService.findFeed(query);
  }

  @Get('trending')
  @Public()
  @ApiOperation({
    summary: 'Trending listings (engagement-ranked over a rolling window)',
  })
  getTrending(@Query() query: QueryTrendingDto) {
    return this.listingsService.findTrending(query);
  }

  @Get('me/all')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user's listings (all statuses)" })
  getMyListings(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryListingsDto,
  ) {
    return this.listingsService.findMine(user.id, query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get listing by ID' })
  getOne(@Param('id') id: string) {
    return this.listingsService.findPublicById(id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a new listing (idempotent via Idempotency-Key header)',
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateListingDto) {
    return this.listingsService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update listing (owner only)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(user.id, id, dto);
  }

  @Post(':id/publish')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish listing (draft → active)' })
  publish(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.listingsService.publish(user.id, id);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete listing (owner only)' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.listingsService.remove(user.id, id);
  }
}
