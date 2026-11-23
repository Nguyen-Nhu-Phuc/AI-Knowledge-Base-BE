import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrganizationCreateRequestStatus,
  OrgRole,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../common/utils/slug.util';
import { generateOpaqueToken, hashToken } from '../common/utils/token-hash.util';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateInviteLinkDto } from './dto/create-invite-link.dto';
import { AuthUser } from '../auth/types/auth-user.type';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTypes } from '../notifications/notification.types';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private orgPublic(org: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    settings: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      settings: org.settings,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  private requestPublic(req: {
    id: string;
    name: string;
    slug: string;
    status: OrganizationCreateRequestStatus;
    reviewNote: string | null;
    organizationId: string | null;
    createdAt: Date;
    updatedAt: Date;
    reviewedAt: Date | null;
    requester?: { id: string; email: string; name: string };
  }) {
    return {
      id: req.id,
      name: req.name,
      slug: req.slug,
      status: req.status,
      reviewNote: req.reviewNote,
      organizationId: req.organizationId,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      reviewedAt: req.reviewedAt,
      ...(req.requester
        ? {
            requester: {
              id: req.requester.id,
              email: req.requester.email,
              name: req.requester.name,
            },
          }
        : {}),
    };
  }

  private normalizeSlug(name: string, slug?: string) {
    const value = (slug?.trim() || slugify(name)).toLowerCase();
    if (!value) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Unable to derive a valid slug from name',
      });
    }
    return value;
  }

  private async assertSlugAvailable(slug: string, excludeRequestId?: string) {
    const existingOrg = await this.prisma.organization.findFirst({
      where: { slug, deletedAt: null },
    });
    if (existingOrg) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Organization slug already taken',
      });
    }

    const pending = await this.prisma.organizationCreateRequest.findFirst({
      where: {
        slug,
        status: OrganizationCreateRequestStatus.pending,
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
    });
    if (pending) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'A pending create request already uses this slug',
      });
    }
  }

  private async materializeOrganization(
    tx: Prisma.TransactionClient,
    params: {
      name: string;
      slug: string;
      ownerUserId: string;
    },
  ) {
    const created = await tx.organization.create({
      data: {
        name: params.name,
        slug: params.slug,
        createdBy: params.ownerUserId,
        settings: {
          allow_member_create_kb: false,
          acl_mode: 'org_wide',
        },
      },
    });

    await tx.organizationMember.create({
      data: {
        organizationId: created.id,
        userId: params.ownerUserId,
        role: OrgRole.owner,
      },
    });

    return created;
  }

  /**
   * Anyone may submit a create request. Platform admins are auto-approved
   * so ops/seed can provision orgs without a second step.
   */
  async create(user: AuthUser, dto: CreateOrganizationDto) {
    const name = dto.name.trim();
    const slug = this.normalizeSlug(name, dto.slug);
    await this.assertSlugAvailable(slug);

    const request = await this.prisma.organizationCreateRequest.create({
      data: {
        name,
        slug,
        requestedBy: user.id,
        status: OrganizationCreateRequestStatus.pending,
      },
    });

    await this.audit.log({
      actorUserId: user.id,
      action: 'organization.create_request',
      resourceType: 'organization_create_request',
      resourceId: request.id,
      metadata: { slug, name },
    });

    if (user.isPlatformAdmin) {
      return this.approveCreateRequest(request.id, user, {
        note: 'Auto-approved for platform admin',
      });
    }

    await this.notifications.notifySuperAdmins({
      type: NotificationTypes.ORG_CREATE_REQUEST,
      title: 'Yêu cầu tạo tổ chức mới',
      body: `${user.name} (${user.email}) yêu cầu tạo «${name}» (${slug}).`,
      link: '/app/super-admin',
      data: {
        requestId: request.id,
        name,
        slug,
        requesterId: user.id,
        requesterName: user.name,
        requesterEmail: user.email,
      },
      excludeUserId: user.id,
    });

    return {
      status: 'pending' as const,
      request: this.requestPublic(request),
    };
  }

  async listMyCreateRequests(userId: string) {
    const rows = await this.prisma.organizationCreateRequest.findMany({
      where: { requestedBy: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.requestPublic(r));
  }

  async listPendingCreateRequests(admin: AuthUser) {
    if (!admin.isPlatformAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Platform admin only',
      });
    }
    const rows = await this.prisma.organizationCreateRequest.findMany({
      where: { status: OrganizationCreateRequestStatus.pending },
      include: {
        requester: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map((r) => this.requestPublic(r));
  }

  async approveCreateRequest(
    requestId: string,
    admin: AuthUser,
    opts?: { note?: string },
  ) {
    if (!admin.isPlatformAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Platform admin only',
      });
    }

    const request = await this.prisma.organizationCreateRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Create request not found',
      });
    }
    if (request.status !== OrganizationCreateRequestStatus.pending) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Request is already ${request.status}`,
      });
    }

    await this.assertSlugAvailable(request.slug, request.id);

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await this.materializeOrganization(tx, {
        name: request.name,
        slug: request.slug,
        ownerUserId: request.requestedBy,
      });

      await tx.organizationCreateRequest.update({
        where: { id: request.id },
        data: {
          status: OrganizationCreateRequestStatus.approved,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          reviewNote: opts?.note?.trim() || null,
          organizationId: created.id,
        },
      });

      return created;
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: admin.id,
      action: 'organization.create_request.approve',
      resourceType: 'organization_create_request',
      resourceId: request.id,
      metadata: { slug: org.slug, organizationId: org.id },
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: request.requestedBy,
      action: 'organization.create',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { slug: org.slug, viaRequestId: request.id },
    });

    if (request.requestedBy !== admin.id) {
      await this.notifications.notify({
        userId: request.requestedBy,
        type: NotificationTypes.ORG_CREATE_APPROVED,
        title: 'Tổ chức đã được phê duyệt',
        body: `«${org.name}» (${org.slug}) đã được Super Admin phê duyệt. Bạn là chủ sở hữu.`,
        link: '/app',
        data: {
          requestId: request.id,
          organizationId: org.id,
          name: org.name,
          slug: org.slug,
        },
      });
    }

    // Flatten org fields for clients/seed that expect Organization shape.
    return {
      status: 'approved' as const,
      ...this.orgPublic(org),
      role: OrgRole.owner,
      request: this.requestPublic({
        ...request,
        status: OrganizationCreateRequestStatus.approved,
        reviewedAt: new Date(),
        reviewNote: opts?.note?.trim() || null,
        organizationId: org.id,
      }),
    };
  }

  async rejectCreateRequest(
    requestId: string,
    admin: AuthUser,
    reason?: string,
  ) {
    if (!admin.isPlatformAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Platform admin only',
      });
    }

    const request = await this.prisma.organizationCreateRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Create request not found',
      });
    }
    if (request.status !== OrganizationCreateRequestStatus.pending) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Request is already ${request.status}`,
      });
    }

    const updated = await this.prisma.organizationCreateRequest.update({
      where: { id: request.id },
      data: {
        status: OrganizationCreateRequestStatus.rejected,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
        reviewNote: reason?.trim() || null,
      },
    });

    await this.audit.log({
      actorUserId: admin.id,
      action: 'organization.create_request.reject',
      resourceType: 'organization_create_request',
      resourceId: request.id,
      metadata: { slug: request.slug, reason: reason?.trim() || null },
    });

    const note = reason?.trim();
    await this.notifications.notify({
      userId: request.requestedBy,
      type: NotificationTypes.ORG_CREATE_REJECTED,
      title: 'Yêu cầu tạo tổ chức bị từ chối',
      body: note
        ? `«${request.name}» (${request.slug}) bị từ chối: ${note}`
        : `«${request.name}» (${request.slug}) đã bị Super Admin từ chối.`,
      link: '/app/settings',
      data: {
        requestId: request.id,
        name: request.name,
        slug: request.slug,
        reason: note || null,
      },
    });

    return {
      status: 'rejected' as const,
      request: this.requestPublic(updated),
    };
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId,
        organization: { deletedAt: null },
      },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      ...this.orgPublic(m.organization),
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async getOne(orgId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
    });
    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return this.orgPublic(org);
  }

  async update(orgId: string, actor: AuthUser, dto: UpdateOrganizationDto) {
    const existing = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const prevSettings = (existing.settings ?? {}) as Record<string, unknown>;
    const nextSettings =
      dto.settings !== undefined
        ? {
            ...prevSettings,
            ...(dto.settings.allow_member_create_kb !== undefined
              ? {
                  allow_member_create_kb: dto.settings.allow_member_create_kb,
                }
              : {}),
            ...(dto.settings.embedding_provider !== undefined
              ? { embedding_provider: dto.settings.embedding_provider }
              : {}),
            ...(dto.settings.llm_provider !== undefined
              ? { llm_provider: dto.settings.llm_provider }
              : {}),
            ...(dto.settings.acl_mode !== undefined
              ? { acl_mode: dto.settings.acl_mode }
              : {}),
          }
        : undefined;

    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(nextSettings !== undefined
          ? { settings: nextSettings as Prisma.InputJsonValue }
          : {}),
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actor.id,
      action: 'organization.update',
      resourceType: 'organization',
      resourceId: orgId,
      metadata: {
        nameChanged: dto.name !== undefined,
        settingsChanged: dto.settings !== undefined,
      },
    });

    return this.orgPublic(org);
  }

  async softDelete(orgId: string, actor: AuthUser) {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actor.id,
      action: 'organization.delete',
      resourceType: 'organization',
      resourceId: orgId,
    });

    return { success: true };
  }

  async listMembers(orgId: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.createdAt,
      user: m.user,
    }));
  }

  private async countOwners(orgId: string) {
    return this.prisma.organizationMember.count({
      where: { organizationId: orgId, role: OrgRole.owner },
    });
  }

  async addMember(orgId: string, actor: AuthUser, dto: AddMemberDto) {
    if (dto.role === OrgRole.owner) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Cannot directly assign owner role; transfer ownership instead',
      });
    }

    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: 'active' },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'User with this email does not exist. Ask them to register first.',
      });
    }

    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: user.id },
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'User is already a member',
      });
    }

    const member = await this.prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        role: dto.role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actor.id,
      action: 'member.add',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { role: dto.role },
    });

    return {
      id: member.id,
      role: member.role,
      joinedAt: member.createdAt,
      user: member.user,
    };
  }

  async updateMemberRole(
    orgId: string,
    targetUserId: string,
    actor: AuthUser,
    actorRole: OrgRole,
    role: OrgRole,
  ) {
    if (role === OrgRole.owner && actorRole !== OrgRole.owner) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only owner can promote to owner',
      });
    }

    const target = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: targetUserId },
      },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Member not found',
      });
    }

    if (target.role === OrgRole.owner && role !== OrgRole.owner) {
      const owners = await this.countOwners(orgId);
      if (owners <= 1) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Cannot demote the last owner',
        });
      }
    }

    const updated = await this.prisma.organizationMember.update({
      where: { id: target.id },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actor.id,
      action: 'member.role_update',
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: { from: target.role, to: role },
    });

    return {
      id: updated.id,
      role: updated.role,
      joinedAt: updated.createdAt,
      user: updated.user,
    };
  }

  async removeMember(
    orgId: string,
    targetUserId: string,
    actor: AuthUser,
  ) {
    const target = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: targetUserId },
      },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Member not found',
      });
    }

    if (target.role === OrgRole.owner) {
      const owners = await this.countOwners(orgId);
      if (owners <= 1) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Cannot remove the last owner',
        });
      }
    }

    await this.prisma.organizationMember.delete({ where: { id: target.id } });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actor.id,
      action: 'member.remove',
      resourceType: 'user',
      resourceId: targetUserId,
      metadata: { role: target.role },
    });

    return { success: true };
  }

  async createInviteLink(
    orgId: string,
    actor: AuthUser,
    dto: CreateInviteLinkDto,
  ) {
    if (dto.role === OrgRole.owner) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invite link cannot grant owner role',
      });
    }

    const token = generateOpaqueToken(32);
    const expiresInDays = dto.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const link = await this.prisma.inviteLink.create({
      data: {
        organizationId: orgId,
        tokenHash: hashToken(token),
        role: dto.role,
        createdBy: actor.id,
        expiresAt,
        maxUses: dto.maxUses ?? null,
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: actor.id,
      action: 'invite_link.create',
      resourceType: 'invite_link',
      resourceId: link.id,
      metadata: { role: dto.role },
    });

    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const prefix = this.config.get<string>('API_PREFIX', 'api/v1');

    return {
      id: link.id,
      role: link.role,
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
      token,
      acceptUrl: `${appUrl}/${prefix}/invite-links/${token}/accept`,
    };
  }

  async acceptInviteLink(token: string, user: AuthUser) {
    const tokenHash = hashToken(token);
    const link = await this.prisma.inviteLink.findUnique({
      where: { tokenHash },
      include: { organization: true },
    });

    if (
      !link ||
      link.revokedAt ||
      link.organization.deletedAt ||
      link.expiresAt.getTime() < Date.now()
    ) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Invite link is invalid or expired',
      });
    }

    if (link.maxUses !== null && link.useCount >= link.maxUses) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invite link has reached max uses',
      });
    }

    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: link.organizationId,
          userId: user.id,
        },
      },
    });
    if (existing) {
      return {
        organizationId: link.organizationId,
        role: existing.role,
        alreadyMember: true,
      };
    }

    await this.prisma.$transaction([
      this.prisma.organizationMember.create({
        data: {
          organizationId: link.organizationId,
          userId: user.id,
          role: link.role,
        },
      }),
      this.prisma.inviteLink.update({
        where: { id: link.id },
        data: { useCount: { increment: 1 } },
      }),
    ]);

    await this.audit.log({
      organizationId: link.organizationId,
      actorUserId: user.id,
      action: 'invite_link.accept',
      resourceType: 'invite_link',
      resourceId: link.id,
      metadata: { role: link.role },
    });

    return {
      organizationId: link.organizationId,
      role: link.role,
      alreadyMember: false,
    };
  }
}
