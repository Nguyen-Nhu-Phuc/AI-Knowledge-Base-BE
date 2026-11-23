import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrgRole } from '@prisma/client';

export class CreateInviteLinkDto {
  @IsEnum(OrgRole)
  role!: OrgRole;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;
}
