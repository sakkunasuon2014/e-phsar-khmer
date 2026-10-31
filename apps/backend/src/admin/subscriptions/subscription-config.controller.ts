import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { SubscriptionConfigService } from './subscription-config.service';
import {
  CreateSubCategoryDto,
  UpdateSubCategoryDto,
  CreateSubPackageDto,
  UpdateSubPackageDto,
  CreateSubTermDto,
  UpdateSubTermDto,
  UpdateFreePlanDto,
  UpdateSubCategoryScopeDto,
} from './dto/subscription-config.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(RolesGuard)
@Controller('admin/subscriptions')
export class SubscriptionConfigController {
  constructor(private readonly service: SubscriptionConfigService) {}

  // Categories
  @Get('categories')
  listCategories() {
    return this.service.listCategories();
  }
  @Post('categories')
  createCategory(@Body() dto: CreateSubCategoryDto) {
    return this.service.createCategory(dto);
  }
  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateSubCategoryDto) {
    return this.service.updateCategory(id, dto);
  }
  @Delete('categories/:id')
  removeCategory(@Param('id') id: string) {
    return this.service.removeCategory(id);
  }
  @Put('categories/:id/scope')
  updateCategoryScope(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubCategoryScopeDto,
  ) {
    return this.service.updateCategoryScope(id, dto);
  }

  // Free plan
  @Get('free-plan')
  getFreePlan() {
    return this.service.getFreePlan();
  }
  @Put('free-plan')
  updateFreePlan(@Body() dto: UpdateFreePlanDto) {
    return this.service.updateFreePlan(dto);
  }

  // Packages (a group's fixed tiers)
  @Get('packages')
  listPackages(@Query('categoryId') categoryId?: string) {
    return this.service.listPackages(categoryId);
  }
  @Post('packages')
  createPackage(@Body() dto: CreateSubPackageDto) {
    return this.service.createPackage(dto);
  }
  @Patch('packages/:id')
  updatePackage(@Param('id') id: string, @Body() dto: UpdateSubPackageDto) {
    return this.service.updatePackage(id, dto);
  }
  @Delete('packages/:id')
  removePackage(@Param('id') id: string) {
    return this.service.removePackage(id);
  }

  // Terms
  @Get('terms')
  listTerms(@Query('packageId') packageId?: string) {
    return this.service.listTerms(packageId);
  }
  @Post('terms')
  createTerm(@Body() dto: CreateSubTermDto) {
    return this.service.createTerm(dto);
  }
  @Patch('terms/:id')
  updateTerm(@Param('id') id: string, @Body() dto: UpdateSubTermDto) {
    return this.service.updateTerm(id, dto);
  }
  @Delete('terms/:id')
  removeTerm(@Param('id') id: string) {
    return this.service.removeTerm(id);
  }
}
