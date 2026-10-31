import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Content-free nudge body. Only an optional listing reference is accepted —
 * the whole point of this endpoint is that no message text ever crosses it
 * (ValidationPipe's global `whitelist` already strips anything else).
 */
export class NudgeDto {
  @ApiPropertyOptional({
    description:
      "The listing the sender attached, if any — its title is the only free text the notification may carry, and only when it's found.",
  })
  @IsOptional()
  @IsUUID()
  listingId?: string;
}
