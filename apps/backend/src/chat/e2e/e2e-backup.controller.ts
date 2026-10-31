import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/api-response.types';
import { E2eBackupService } from './e2e-backup.service';
import {
  AddBackupSegmentDto,
  InitBackupDto,
  ListBackupSegmentsDto,
  SetBackupPasscodeDto,
  UnlockBackupDto,
} from './dto/backup.dto';

/**
 * Encrypted chat-history backup + new-device approval. The server only ever
 * holds ciphertext under the account's backup key (BK); see
 * E2eBackupService and tasks/plan-e2e-multi-device.md.
 */
@ApiTags('chats')
@ApiBearerAuth()
@Controller('chats/e2e')
export class E2eBackupController {
  constructor(private readonly backup: E2eBackupService) {}

  @Get('backup')
  @ApiOperation({ summary: 'Backup status (exists, passcode set, lock)' })
  getStatus(@CurrentUser() user: RequestUser) {
    return this.backup.getStatus(user.id);
  }

  @Post('backup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: "Create the account's backup (first device wins the race)",
  })
  init(@CurrentUser() user: RequestUser, @Body() dto: InitBackupDto) {
    return this.backup.init(user.id, dto);
  }

  @Put('backup/passcode')
  @ApiOperation({ summary: 'Set or change the backup passcode' })
  setPasscode(
    @CurrentUser() user: RequestUser,
    @Body() dto: SetBackupPasscodeDto,
  ) {
    return this.backup.setPasscode(user.id, dto);
  }

  @Post('backup/unlock')
  @HttpCode(200)
  // Belt and braces on top of the per-account attempt counter.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Prove the passcode, receive the wrapped backup key',
  })
  unlock(@CurrentUser() user: RequestUser, @Body() dto: UnlockBackupDto) {
    return this.backup.unlock(user.id, dto.authKey);
  }

  @Post('backup/segments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Upload one encrypted history segment' })
  addSegment(
    @CurrentUser() user: RequestUser,
    @Body() dto: AddBackupSegmentDto,
  ) {
    return this.backup.addSegment(user.id, dto);
  }

  @Get('backup/segments')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Page through encrypted history segments' })
  listSegments(
    @CurrentUser() user: RequestUser,
    @Query() query: ListBackupSegmentsDto,
  ) {
    return this.backup.listSegments(user.id, query);
  }
}
