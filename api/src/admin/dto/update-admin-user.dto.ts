import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  @IsOptional()
  @IsBoolean()
  isPlatformAdmin?: boolean;
}
