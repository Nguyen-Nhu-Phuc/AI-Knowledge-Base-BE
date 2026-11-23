import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OrgRole } from '@prisma/client';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { BotsService } from './bots.service';

class CreateBotDto {
  @IsUUID()
  knowledgeBaseId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  systemPrompt?: string;
}

class UpdateBotDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  systemPrompt?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';

  @IsOptional()
  @IsUUID()
  knowledgeBaseId?: string;
}

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class BotsController {
  constructor(private readonly bots: BotsService) {}

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/bots')
  list(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.bots.list(orgId);
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Post('organizations/:orgId/bots')
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBotDto,
  ) {
    return this.bots.create(orgId, user, dto);
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Patch('organizations/:orgId/bots/:botId')
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
    @Body() dto: UpdateBotDto,
  ) {
    return this.bots.update(orgId, botId, dto);
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Delete('organizations/:orgId/bots/:botId')
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
  ) {
    return this.bots.softDelete(orgId, botId);
  }
}
