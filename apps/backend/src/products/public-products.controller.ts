import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { QueryProductsDto } from './dto/query-products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class PublicProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'Search published product specs (public, used by search + post form)',
  })
  list(@Query() query: QueryProductsDto) {
    return this.service.listPublished(query);
  }

  @Get(':brandSlug/:modelSlug')
  @Public()
  @ApiOperation({
    summary: 'Get a published product spec page by brand/model slug',
  })
  getOne(
    @Param('brandSlug') brandSlug: string,
    @Param('modelSlug') modelSlug: string,
  ) {
    return this.service.getPublishedBySlug(brandSlug, modelSlug);
  }
}
