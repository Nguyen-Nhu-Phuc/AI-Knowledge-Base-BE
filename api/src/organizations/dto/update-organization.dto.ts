import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrganizationSettingsDto {
  @IsOptional()
  @IsBoolean()
  allow_member_create_kb?: boolean;

  /** Text → Vector provider override */
  @IsOptional()
  @IsString()
  @IsIn(['mock', 'openai', 'gemini'])
  embedding_provider?: 'mock' | 'openai' | 'gemini';

  /** Text → Answer provider override */
  @IsOptional()
  @IsString()
  @IsIn(['mock', 'openai', 'gemini'])
  llm_provider?: 'mock' | 'openai' | 'gemini';

  /** org_wide = all members see all KB docs; restricted = ACL grants */
  @IsOptional()
  @IsString()
  @IsIn(['org_wide', 'restricted'])
  acl_mode?: 'org_wide' | 'restricted';

  @IsOptional()
  @IsBoolean()
  dlp_enabled?: boolean;

  /** Soft retention hint in days (0 = unlimited) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  retention_days?: number;

  /** Monthly AI request soft quota (0 = unlimited) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  ai_monthly_quota?: number;

  @IsOptional()
  @IsString()
  slack_default_kb_id?: string;

  @IsOptional()
  @IsString()
  default_kb_id?: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OrganizationSettingsDto)
  settings?: OrganizationSettingsDto;
}
