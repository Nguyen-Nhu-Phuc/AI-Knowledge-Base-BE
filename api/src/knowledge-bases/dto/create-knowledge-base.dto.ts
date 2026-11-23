import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
