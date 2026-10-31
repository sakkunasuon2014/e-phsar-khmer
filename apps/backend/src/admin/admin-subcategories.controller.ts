import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminSubcategoriesService } from './admin-subcategories.service';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/subcategories')
export class AdminSubcategoriesController {
  constructor(private readonly service: AdminSubcategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List subcategories (optionally by categoryId)' })
  list(@Query('categoryId') categoryId?: string) {
    return this.service.list(categoryId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a subcategory (+ en/km translations)' })
  create(@Body() dto: CreateSubcategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a subcategory (+ en/km names)' })
  update(@Param('id') id: string, @Body() dto: UpdateSubcategoryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a subcategory' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
