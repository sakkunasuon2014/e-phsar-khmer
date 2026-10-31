import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { E2eHeaderDto } from './e2e-header.dto';
import { E2eV2PayloadDto } from './e2e-v2.dto';
import { ATTACHMENTS_PER_MESSAGE_MAX } from '../chat-attachments.constants';

export class SendMessageDto {
  @ApiProperty({ description: 'User to send the message to' })
  @IsUUID()
  recipientId: string;

  @ApiPropertyOptional({
    description:
      'Client-generated dedup key (e.g. a UUID minted before sending). A retry with the same key replays the original message instead of creating a duplicate — mainly for the WS path, where there is no Idempotency-Key header to fall back on.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientMessageId?: string;

  // Every new message carries an encrypted body. The service requires an
  // E2E envelope and rejects the legacy plaintext imagePath below.
  // 24000 matches messages_body_length_max: base64 ciphertext is larger than
  // the plaintext it encodes.
  @ApiPropertyOptional({ maxLength: 24000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(24000)
  body?: string;

  @ApiPropertyOptional({
    description: 'Listing shown as a context card with this message',
  })
  @IsOptional()
  @IsUUID()
  listingId?: string;

  @ApiPropertyOptional({
    description:
      'Legacy public-image path. New chat sends reject this; use E2E v2 attachmentIds instead.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imagePath?: string;

  @ApiPropertyOptional({
    description:
      'Groups related images together (e.g. multiple photos in one send). Shared across messages in the same batch.',
  })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({
    description:
      'Signal-protocol envelope for this message. Required for new sends unless the v2 e2e payload is supplied. The body is ciphertext.',
    type: E2eHeaderDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => E2eHeaderDto)
  e2eHeader?: E2eHeaderDto;

  @ApiPropertyOptional({
    description:
      "v1 only: the recipient identity key this message was encrypted to. When present and it no longer matches the recipient's registered key, the send is rejected with 409 E2E_SESSION_STALE so the client restarts the session instead of sending an undecryptable message.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientIdentityKey?: string;

  @ApiPropertyOptional({
    description:
      'Multi-device E2E (v2). Mutually exclusive with e2eHeader. Files ride along via attachmentIds, never imagePath.',
    type: E2eV2PayloadDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => E2eV2PayloadDto)
  e2e?: E2eV2PayloadDto;

  @ApiPropertyOptional({
    description:
      'Encrypted attachments (from POST /chats/attachments, completed) carried by this message. Requires `e2e` (v2); their keys and metadata are inside the encrypted body.',
    type: [String],
    maxItems: ATTACHMENTS_PER_MESSAGE_MAX,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATTACHMENTS_PER_MESSAGE_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}
