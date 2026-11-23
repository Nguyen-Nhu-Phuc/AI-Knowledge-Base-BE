import {
  IsInt,
  IsMimeType,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUploadUrlDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @IsMimeType()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  byteSize!: number;

  /** Optional: upload a new version for an existing document */
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
