import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';

type MembershipRequest = {
  membership: { role: OrgRole };
};

@Controller('organizations/:orgId/knowledge-bases')
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class KnowledgeBasesController {
  constructor(private readonly knowledgeBasesService: KnowledgeBasesService) {}

  @Roles(OrgRole.member)
  @Post()
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
    @Body() dto: CreateKnowledgeBaseDto,
  ) {
    return this.knowledgeBasesService.create(orgId, user, req.membership.role, dto);
  }

  @Roles(OrgRole.viewer)
  @Get()
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Req() req: MembershipRequest,
  ) {
    return this.knowledgeBasesService.list(orgId, req.membership.role);
  }

  @Roles(OrgRole.viewer)
  @Get(':kbId')
  getOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Req() req: MembershipRequest,
  ) {
    return this.knowledgeBasesService.getOne(orgId, kbId, req.membership.role);
  }

  @Roles(OrgRole.admin)
  @Patch(':kbId')
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledgeBasesService.update(orgId, kbId, user, dto);
  }

  @Roles(OrgRole.admin)
  @Delete(':kbId')
  softDelete(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledgeBasesService.softDelete(orgId, kbId, user);
  }
}
