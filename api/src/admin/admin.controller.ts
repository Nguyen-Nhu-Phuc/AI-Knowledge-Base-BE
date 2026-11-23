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
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { OrganizationsService } from '../organizations/organizations.service';
import { RejectOrgCreateRequestDto } from '../organizations/dto/reject-org-create-request.dto';
import { AdminService } from './admin.service';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { UpdateAdminOrgSettingsDto } from './dto/update-admin-org-settings.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly admin: AdminService,
  ) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.admin.overview(user);
  }

  @Get('users')
  listUsers(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
  ) {
    return this.admin.listUsers(user, {
      q,
      status,
      take: take ? Number(take) : undefined,
    });
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.admin.updateUser(user, id, dto);
  }

  @Get('usage')
  platformUsage(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.platformUsage(
      user,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('platform-settings')
  getPlatformSettings(@CurrentUser() user: AuthUser) {
    return this.admin.getPlatformSettings(user);
  }

  @Patch('platform-settings')
  updatePlatformSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePlatformSettingsDto,
  ) {
    return this.admin.updatePlatformSettings(user, dto);
  }

  @Get('organization-create-requests')
  listCreateRequests(@CurrentUser() user: AuthUser) {
    return this.organizations.listPendingCreateRequests(user);
  }

  @Post('organization-create-requests/:id/approve')
  approveCreateRequest(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.organizations.approveCreateRequest(id, user);
  }

  @Post('organization-create-requests/:id/reject')
  rejectCreateRequest(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrgCreateRequestDto,
  ) {
    return this.organizations.rejectCreateRequest(id, user, dto.reason);
  }

  @Get('organizations')
  async listOrganizations(@CurrentUser() user: AuthUser) {
    this.admin.assertSuperAdmin(user);
    return this.prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        settings: true,
        createdAt: true,
        _count: { select: { members: true, knowledgeBases: true } },
      },
    });
  }

  @Patch('organizations/:id')
  updateOrganization(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminOrgSettingsDto,
  ) {
    return this.admin.updateOrganization(user, id, dto);
  }

  @Get('jobs')
  async listFailedJobs(@CurrentUser() user: AuthUser) {
    this.admin.assertSuperAdmin(user);
    return this.prisma.ingestionJob.findMany({
      where: { status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  @Delete('organizations/:id')
  deleteOrganization(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.deleteOrganization(user, id);
  }

  /** @deprecated Prefer DELETE /admin/organizations/:id */
  @Post('organizations/:id/disable')
  disableOrg(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.deleteOrganization(user, id);
  }
}
