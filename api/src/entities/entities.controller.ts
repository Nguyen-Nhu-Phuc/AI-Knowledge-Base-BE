import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EntityType, OrgRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { EntitiesService } from './entities.service';

class ListEntitiesQuery {
  @IsOptional()
  @IsEnum(EntityType)
  type?: EntityType;

  @IsOptional()
  @IsString()
  q?: string;
}

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/entities')
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListEntitiesQuery,
  ) {
    if (query.q) {
      return this.entities.searchPeople(orgId, query.q);
    }
    return this.entities.list(orgId, query.type);
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Post('organizations/:orgId/entities/rebuild')
  rebuild(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.entities.rebuildGraph(orgId);
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/documents/:docId/entities')
  forDocument(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.entities.relatedToDocument(orgId, docId);
  }
}
