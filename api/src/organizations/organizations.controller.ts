import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OrganizationsService } from './organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { CreateInviteLinkDto } from './dto/create-invite-link.dto';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

type MembershipRequest = {
  membership: { role: OrgRole };
};

@Controller()
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post('organizations')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(user, dto);
  }

  @Get('organizations/create-requests')
  listMyCreateRequests(@CurrentUser() user: AuthUser) {
    return this.organizationsService.listMyCreateRequests(user.id);
  }

  @Get('organizations')
  list(@CurrentUser() user: AuthUser) {
    return this.organizationsService.listForUser(user.id);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId')
  getOne(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.organizationsService.getOne(orgId);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin)
  @Patch('organizations/:orgId')
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(orgId, user, dto);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.owner)
  @Delete('organizations/:orgId')
  softDelete(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationsService.softDelete(orgId, user);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/members')
  listMembers(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.organizationsService.listMembers(orgId);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin)
  @Post('organizations/:orgId/members')
  addMember(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddMemberDto,
  ) {
    return this.organizationsService.addMember(orgId, user, dto);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin)
  @Patch('organizations/:orgId/members/:userId')
  updateMemberRole(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: MembershipRequest,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(
      orgId,
      userId,
      user,
      req.membership.role,
      dto.role,
    );
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin)
  @Delete('organizations/:orgId/members/:userId')
  removeMember(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationsService.removeMember(orgId, userId, user);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin)
  @Post('organizations/:orgId/invite-links')
  createInviteLink(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInviteLinkDto,
  ) {
    return this.organizationsService.createInviteLink(orgId, user, dto);
  }

  @HttpCode(200)
  @Post('invite-links/:token/accept')
  acceptInviteLink(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationsService.acceptInviteLink(token, user);
  }
}
