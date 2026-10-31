import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { E2eHeaderDto } from '../../chat/dto/e2e-header.dto';
import { E2eV2PayloadDto } from '../../chat/dto/e2e-v2.dto';

/**
 * Applying to a job. The cover note is optional — the résumé snapshot and the
 * resulting chat message are the substance of an application, and forcing a
 * sentence out of someone who already wrote a CV only produces "I want this
 * job." An empty note falls back to a default line in the chat message.
 *
 * The chat copy is encrypted in the applicant's browser: `body` is ciphertext
 * and the E2E payload (v2 `e2e`, or v1 `e2eHeader`) carries the per-device
 * key material. The server never composes or reads that message. Both-or-
 * neither is enforced by the service; plaintext is impossible because the
 * chat write path refuses it. When the poster has no encrypted-chat devices
 * there is no one to encrypt to, so the application is recorded without a
 * chat message (the poster still gets the application row and notification).
 */
export class CreateApplicationDto {
  @ApiPropertyOptional({
    description: 'Short note to the poster',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverNote?: string;

  // 24000 matches messages_body_length_max: base64 ciphertext is larger than
  // the plaintext it encodes.
  @ApiPropertyOptional({
    description:
      'The encrypted chat copy of the application (ciphertext). Requires an E2E payload; omit to record the application without a chat message.',
    maxLength: 24000,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(24000)
  body?: string;

  @ApiPropertyOptional({
    description:
      'Signal-protocol envelope (v1). Mutually exclusive with `e2e`; required with `body` unless `e2e` is supplied.',
    type: E2eHeaderDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => E2eHeaderDto)
  e2eHeader?: E2eHeaderDto;

  @ApiPropertyOptional({
    description:
      "v1 only: the recipient identity key the message was encrypted to. A mismatch with the poster's current key answers 409 E2E_SESSION_STALE so the client restarts the session.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientIdentityKey?: string;

  @ApiPropertyOptional({
    description:
      'Multi-device E2E payload (v2). Mutually exclusive with `e2eHeader`.',
    type: E2eV2PayloadDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => E2eV2PayloadDto)
  e2e?: E2eV2PayloadDto;
}
