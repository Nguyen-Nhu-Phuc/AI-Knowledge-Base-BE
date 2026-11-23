import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePlatformSettingsDto {
  @IsOptional()
  @IsIn(['mock', 'openai', 'gemini'])
  defaultEmbeddingProvider?: string;

  @IsOptional()
  @IsIn(['mock', 'openai', 'gemini'])
  defaultLlmProvider?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  costPer1kInputUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  costPer1kOutputUsd?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
