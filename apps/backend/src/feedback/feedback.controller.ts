import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FEEDBACK_MAX_IMAGES, FeedbackService } from './feedback.service';
import { CreateFeedbackDto, ListFeedbackDto } from './dto/feedback.dto';

@ApiTags('feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly service: FeedbackService,
    private readonly jwt: JwtService,
  ) {}

  @Post()
  @Public()
  // Anonymous and image-bearing: keep it tight per IP.
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('images', FEEDBACK_MAX_IMAGES, {
      limits: { fileSize: 5 * 1024 * 1024, files: FEEDBACK_MAX_IMAGES },
    }),
  )
  @ApiOperation({
    summary:
      'Submit feedback (public; linked to the account when a valid bearer token is sent)',
  })
  create(
    @Body() dto: CreateFeedbackDto,
    @UploadedFiles() images: Express.Multer.File[] | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    return this.service.create(
      dto,
      images ?? [],
      this.optionalUserId(authorization),
    );
  }

  /**
   * The route is @Public, so JwtAuthGuard never sets req.user; a token is
   * optional here and only links the submission — an invalid one is simply
   * ignored rather than rejected.
   */
  private optionalUserId(authorization?: string): string | null {
    if (!authorization?.startsWith('Bearer ')) return null;
    try {
      const payload = this.jwt.verify<{ sub?: string; typ?: string }>(
        authorization.slice(7),
      );
      return payload.typ ? null : (payload.sub ?? null);
    } catch {
      return null;
    }
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@UseGuards(RolesGuard)
@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get()
  @ApiOperation({ summary: 'List feedback, newest first (offset paged)' })
  list(@Query() query: ListFeedbackDto) {
    return this.service.list(query);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete feedback and its images' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
