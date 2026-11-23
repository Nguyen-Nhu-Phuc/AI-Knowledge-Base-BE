import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DocumentStatus, OrgRole } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { DocumentsService } from './documents.service';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { ConfirmDocumentDto } from './dto/confirm-document.dto';

class ListDocumentsQueryDto {
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
}

class UpdateGovernanceDto {
  @IsOptional()
  @IsBoolean()
  verify?: boolean;

  @IsOptional()
  @IsBoolean()
  reject?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  ownerUserId?: string | null;
}

class CreateNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(200000)
  content!: string;
}

type MembershipRequest = {
  membership: { role: OrgRole };
};

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Roles(OrgRole.member)
  @Post('organizations/:orgId/knowledge-bases/:kbId/documents/upload-url')
  createUploadUrl(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
    @Body() dto: CreateUploadUrlDto,
  ) {
    return this.documentsService.createUploadUrl(
      orgId,
      kbId,
      user,
      req.membership.role,
      dto,
    );
  }

  @Roles(OrgRole.member)
  @Post('organizations/:orgId/knowledge-bases/:kbId/documents')
  confirmUpload(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
    @Body() dto: ConfirmDocumentDto,
  ) {
    return this.documentsService.confirmUpload(
      orgId,
      kbId,
      user,
      req.membership.role,
      dto,
    );
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/knowledge-bases/:kbId/documents')
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Query() query: ListDocumentsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.list(orgId, kbId, query.status, user.id);
  }

  @Roles(OrgRole.member)
  @Post('organizations/:orgId/knowledge-bases/:kbId/notes')
  createNote(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
    @Body() dto: CreateNoteDto,
  ) {
    return this.documentsService.createNote(
      orgId,
      kbId,
      user,
      req.membership.role,
      dto,
    );
  }

  @Roles(OrgRole.member)
  @Patch('organizations/:orgId/documents/:docId/governance')
  updateGovernance(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
    @Body() dto: UpdateGovernanceDto,
  ) {
    return this.documentsService.updateGovernance(
      orgId,
      docId,
      user,
      req.membership.role,
      dto,
    );
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/documents/:docId')
  getOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentsService.getOne(orgId, docId);
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/documents/:docId/download-url')
  downloadUrl(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AuthUser,
    @Query('versionId') versionId?: string,
  ) {
    return this.documentsService.createDownloadUrl(
      orgId,
      docId,
      user.id,
      versionId,
    );
  }

  @Roles(OrgRole.member)
  @Delete('organizations/:orgId/documents/:docId')
  softDelete(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
  ) {
    return this.documentsService.softDelete(
      orgId,
      docId,
      user,
      req.membership.role,
    );
  }

  @Roles(OrgRole.member)
  @Post('organizations/:orgId/documents/:docId/reprocess')
  reprocess(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
  ) {
    return this.documentsService.reprocess(
      orgId,
      docId,
      user,
      req.membership.role,
    );
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/documents/:docId/versions')
  listVersions(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentsService.listVersions(orgId, docId);
  }

  @Roles(OrgRole.member)
  @Post('organizations/:orgId/documents/:docId/versions/:versionId/activate')
  activateVersion(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
  ) {
    return this.documentsService.activateVersion(
      orgId,
      docId,
      versionId,
      user,
      req.membership.role,
    );
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/documents/:docId/chunks')
  listChunks(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentsService.listChunks(orgId, docId);
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/documents/:docId/jobs')
  listJobs(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documentsService.listJobs(orgId, docId);
  }

  @Roles(OrgRole.member)
  @Post('organizations/:orgId/jobs/:jobId/retry')
  retryJob(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
  ) {
    return this.documentsService.retryJob(
      orgId,
      jobId,
      user,
      req.membership.role,
    );
  }
}
