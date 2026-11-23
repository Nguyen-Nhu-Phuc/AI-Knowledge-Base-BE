import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateAdminOrgSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['free', 'pro', 'enterprise'])
  plan?: string;

  @IsOptional()
  @IsIn(['mock', 'openai', 'gemini'])
  embeddingProvider?: string;

  @IsOptional()
  @IsIn(['mock', 'openai', 'gemini'])
  llmProvider?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  aiMonthlyQuota?: number;
}
