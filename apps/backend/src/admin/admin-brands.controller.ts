import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminBrandsService } from './admin-brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(private readonly service: AdminBrandsService) {}

  @Get()
  @ApiOperation({ summary: 'List brands with their linked subcategories' })
  list() {
    return this.service.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a brand (+ subcategory links)' })
  create(@Body() dto: CreateBrandDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a brand (+ replace subcategory links)' })
  update(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a brand (cascades links + models)' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
