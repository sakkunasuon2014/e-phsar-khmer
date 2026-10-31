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
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdvertisementsService } from './advertisements.service';
import {
  CreateAdvertisementDto,
  QueryAdvertisementsDto,
  UpdateAdvertisementDto,
} from './dto/advertisement.dto';

@ApiTags('advertisements')
@Controller('advertisements')
export class AdvertisementsController {
  constructor(private readonly service: AdvertisementsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Active banners, optionally for one placement (public)',
  })
  list(@Query() query: QueryAdvertisementsDto) {
    return this.service.listActive(query.placement);
  }
}

/**
 * super_admin only, matching the Team page: banner content is storefront-wide
 * and is not delegated to regular admins.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('super_admin')
@UseGuards(RolesGuard)
@Controller('admin/advertisements')
export class AdminAdvertisementsController {
  constructor(private readonly service: AdvertisementsService) {}

  @Get()
  @ApiOperation({ summary: 'List every banner, including inactive ones' })
  list(@Query() query: QueryAdvertisementsDto) {
    return this.service.listAll(query.placement);
  }

  @Post()
  @ApiOperation({ summary: 'Create a banner' })
  create(
    @Body() dto: CreateAdvertisementDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a banner, including its placement' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdvertisementDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a banner and its stored image' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
