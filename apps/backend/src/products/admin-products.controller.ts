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
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List product specs (published and draft)' })
  list(@Query() query: QueryProductsDto) {
    return this.service.listAdmin(query.family);
  }

  @Get('template/:family')
  @ApiOperation({ summary: 'Get a family spec template (the admin form)' })
  template(@Param('family') family: string) {
    return this.service.getTemplate(family);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product spec page for a model' })
  create(@Body() dto: CreateProductDto) {
    return this.service.createAdmin(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a product spec (model is immutable)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.updateAdmin(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product spec page' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.removeAdmin(id);
  }
}
