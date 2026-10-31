import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/types/api-response.types';
import { FilesService, STAFF_SCOPES } from './files.service';

const isStaff = (user: RequestUser) =>
  user.role === 'admin' || user.role === 'super_admin';

class SignUploadDto {
  @IsString()
  @MaxLength(200)
  filename: string;

  @IsIn([
    'avatar',
    'cover',
    'listing',
    'chat',
    'report',
    'resume',
    'category',
    'subcategory',
    'brand',
    'model',
    'product',
    'attribute',
    'advertisement',
  ])
  scope:
    | 'avatar'
    | 'cover'
    | 'listing'
    | 'chat'
    | 'report'
    | 'resume'
    | 'category'
    | 'subcategory'
    | 'brand'
    | 'model'
    | 'product'
    | 'attribute'
    | 'advertisement';
}

class DeleteFilesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  paths: string[];
}

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('sign')
  @ApiOperation({ summary: 'Get a signed upload URL for a file' })
  getSignedUploadUrl(
    @CurrentUser() user: RequestUser,
    @Body() dto: SignUploadDto,
  ) {
    const isStaffScope = (STAFF_SCOPES as readonly string[]).includes(
      dto.scope,
    );
    if (isStaffScope && !isStaff(user)) {
      throw new ForbiddenException('Only admins can upload catalog images');
    }
    // User scopes are namespaced per user so ownership can be proven by
    // prefix later — ChatService checks `chat/{userId}/` on imagePath, and
    // listings/DELETE /files check `{scope}/{userId}/` the same way.
    const folder = isStaffScope ? dto.scope : `${dto.scope}/${user.id}`;
    return this.filesService.createSignedUploadUrl(
      this.filesService.getDefaultBucket(),
      folder,
      dto.filename,
    );
  }

  @Delete()
  @ApiOperation({ summary: 'Delete files by storage paths' })
  deleteFiles(@CurrentUser() user: RequestUser, @Body() dto: DeleteFilesDto) {
    // Staff clean up catalog images (and anything else) from the dashboard.
    // Everyone else may only delete objects in their own folders: a listing
    // photo's or chat image's path is visible to other users, so without this
    // anyone who saw a path could delete the object behind it.
    if (!isStaff(user)) {
      for (const path of dto.paths) {
        if (!this.filesService.isOwnedPath(path, user.id)) {
          throw new ForbiddenException('Cannot delete files you do not own');
        }
      }
    }
    return this.filesService
      .remove(this.filesService.getDefaultBucket(), dto.paths)
      .then(() => ({ removed: true }));
  }
}
