import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { KnowledgeBaseStatus } from '@prisma/client';

export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(KnowledgeBaseStatus)
  status?: KnowledgeBaseStatus;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
