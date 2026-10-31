import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InitBackupDto {
  @ApiProperty({ description: 'The calling device (must be active and yours)' })
  @IsUUID()
  deviceId: string;

  @ApiProperty({ description: 'base64 HMAC(BK, "npic-backup-check")' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyCheck: string;

  @ApiProperty({
    description:
      'base64 HMAC(BK, "npic-backup-proof") — secret; only its hash is stored',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyProof: string;
}

export class BackupKdfParamsDto {
  @ApiProperty({ enum: ['argon2id'] })
  @IsIn(['argon2id'])
  alg: 'argon2id';

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(20)
  t: number;

  @ApiProperty({ description: 'KiB' })
  @IsInt()
  @Min(8192)
  @Max(262144)
  m: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(8)
  p: number;
}

export class SetBackupPasscodeDto {
  @ApiProperty({
    description:
      'keyCheck of the BK being wrapped — must match the account backup',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyCheck: string;

  @ApiProperty({
    description:
      'base64 HMAC(BK, "npic-backup-proof") — proves the caller holds BK',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyProof: string;

  @ApiProperty({ description: 'base64 argon2id salt' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  salt: string;

  @ApiProperty({ type: BackupKdfParamsDto })
  @ValidateNested()
  @Type(() => BackupKdfParamsDto)
  params: BackupKdfParamsDto;

  @ApiProperty({ description: 'base64 AES-GCM(passcode key, BK)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  wrappedKey: string;

  @ApiProperty({
    description:
      'base64 passcode-derived auth key (never the passcode or wrap key)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  authKey: string;
}

export class UnlockBackupDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  authKey: string;
}

export class AddBackupSegmentDto {
  @ApiProperty()
  @IsUUID()
  deviceId: string;

  // Must fit the 1 MB JSON body limit (main.ts) with room for the envelope —
  // the client caps segments at SEGMENT_MAX_BYTES of plaintext (backup.ts).
  @ApiProperty({ description: 'base64 AES-GCM(BK, JSON items)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(900_000)
  ciphertext: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5000)
  messageCount: number;
}

export class ListBackupSegmentsDto {
  @ApiProperty({ description: 'The calling device (must be active and yours)' })
  @IsUUID()
  deviceId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
