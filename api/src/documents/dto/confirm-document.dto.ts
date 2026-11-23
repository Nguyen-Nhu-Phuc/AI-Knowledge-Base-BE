import {
  IsInt,
  IsMimeType,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ConfirmDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  storageKey!: string;

  @IsMimeType()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  byteSize!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/i, {
    message: 'checksum must be sha256 hex (64 chars)',
  })
  checksum!: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;

  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalFilename?: string;
}
