import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/api-response.types';
import { E2eNudgeService } from './e2e-nudge.service';
import { NudgeDto } from './dto/nudge.dto';

/**
 * Content-free "someone wants to chat" nudge — fired by a sender's browser
 * the moment it discovers the recipient has no E2E device at all, so it is
 * HOLDING the message rather than ever sending plaintext. See
 * `E2eNudgeService` for the no-plaintext guarantee this endpoint keeps.
 */
@ApiTags('chats')
@ApiBearerAuth()
@Controller('chats/e2e')
export class E2eNudgeController {
  constructor(private readonly nudgeService: E2eNudgeService) {}

  @Post('nudge/:userId')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Content-free nudge: tell userId someone wants to chat, no message text, at most once per 24h',
  })
  nudge(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: NudgeDto,
  ) {
    return this.nudgeService.nudge(user.id, userId, dto);
  }
}
