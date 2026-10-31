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
import { AdminModelsService } from './admin-models.service';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/models')
export class AdminModelsController {
  constructor(private readonly service: AdminModelsService) {}

  @Get()
  @ApiOperation({ summary: 'List models (optionally by brandId)' })
  list(@Query('brandId') brandId?: string) {
    return this.service.list(brandId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a model' })
  create(@Body() dto: CreateModelDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a model' })
  update(@Param('id') id: string, @Body() dto: UpdateModelDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a model' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
