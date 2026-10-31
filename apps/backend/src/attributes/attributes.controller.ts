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
import { AttributesService } from './attributes.service';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/attributes/:type')
export class AttributesController {
  constructor(private readonly service: AttributesService) {}

  @Get()
  @ApiOperation({ summary: 'List options for an attribute type' })
  list(@Param('type') type: string) {
    return this.service.list(type);
  }

  @Post()
  @ApiOperation({ summary: 'Create an option for an attribute type' })
  create(@Param('type') type: string, @Body() dto: CreateAttributeDto) {
    return this.service.create(type, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an attribute option' })
  update(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: UpdateAttributeDto,
  ) {
    return this.service.update(type, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an attribute option' })
  remove(@Param('type') type: string, @Param('id') id: string) {
    return this.service.remove(type, id);
  }
}
