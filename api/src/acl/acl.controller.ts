import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, MinLength } from 'class-validator';
import { OrgRole } from '@prisma/client';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AclService } from './acl.service';

class UpsertAclDto {
  @IsIn(['user', 'role'])
  principalType!: 'user' | 'role';

  @IsString()
  @MinLength(1)
  principalId!: string;

  @IsIn(['read', 'write', 'admin'])
  permission!: 'read' | 'write' | 'admin';
}

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class AclController {
  constructor(private readonly acl: AclService) {}

  @Get('organizations/:orgId/knowledge-bases/:kbId/acls')
  @Roles(OrgRole.admin, OrgRole.owner)
  listKb(@Param('kbId') kbId: string) {
    return this.acl.listKbAcls(kbId);
  }

  @Post('organizations/:orgId/knowledge-bases/:kbId/acls')
  @Roles(OrgRole.admin, OrgRole.owner)
  upsertKb(@Param('kbId') kbId: string, @Body() dto: UpsertAclDto) {
    return this.acl.upsertKbAcl({ knowledgeBaseId: kbId, ...dto });
  }

  @Delete('organizations/:orgId/knowledge-bases/:kbId/acls/:aclId')
  @Roles(OrgRole.admin, OrgRole.owner)
  deleteKb(@Param('kbId') kbId: string, @Param('aclId') aclId: string) {
    return this.acl.deleteKbAcl(aclId, kbId);
  }

  @Get('organizations/:orgId/documents/:docId/acls')
  @Roles(OrgRole.admin, OrgRole.owner)
  listDoc(@Param('docId') docId: string) {
    return this.acl.listDocAcls(docId);
  }

  @Post('organizations/:orgId/documents/:docId/acls')
  @Roles(OrgRole.admin, OrgRole.owner)
  upsertDoc(@Param('docId') docId: string, @Body() dto: UpsertAclDto) {
    return this.acl.upsertDocAcl({ documentId: docId, ...dto });
  }

  @Delete('organizations/:orgId/documents/:docId/acls/:aclId')
  @Roles(OrgRole.admin, OrgRole.owner)
  deleteDoc(@Param('docId') docId: string, @Param('aclId') aclId: string) {
    return this.acl.deleteDocAcl(aclId, docId);
  }
}