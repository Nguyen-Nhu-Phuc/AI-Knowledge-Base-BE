import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { OrgRole } from '@prisma/client';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ConnectorsService } from './connectors.service';

class CreateConnectorDto {
  @IsUUID()
  knowledgeBaseId!: string;

  @IsIn([
    'local_folder',
    'google_drive',
    'notion',
    'confluence',
    'slack_export',
  ])
  type!:
    | 'local_folder'
    | 'google_drive'
    | 'notion'
    | 'confluence'
    | 'slack_export';

  @IsString()
  @MinLength(2)
  name!: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;
}

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Roles(OrgRole.admin, OrgRole.owner)
  @Get('organizations/:orgId/connectors')
  list(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.connectors.list(orgId);
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Post('organizations/:orgId/connectors')
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConnectorDto,
  ) {
    return this.connectors.create(orgId, user, {
      knowledgeBaseId: dto.knowledgeBaseId,
      type: dto.type,
      name: dto.name,
      config: dto.config || {},
    });
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Post('organizations/:orgId/connectors/:connectorId/sync')
  sync(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('connectorId', ParseUUIDPipe) connectorId: string,
  ) {
    return this.connectors.syncNow(orgId, connectorId);
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Delete('organizations/:orgId/connectors/:connectorId')
  remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('connectorId', ParseUUIDPipe) connectorId: string,
  ) {
    return this.connectors.remove(orgId, connectorId);
  }
}
