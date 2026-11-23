import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { UpdateAdminOrgSettingsDto } from './dto/update-admin-org-settings.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTypes } from '../notifications/notification.types';

const SETTINGS_ID = 'default';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  assertSuperAdmin(user: AuthUser) {
    if (!user.isPlatformAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Super Admin only',
      });
    }
  }

  private async getOrCreateSettings() {
    const existing = await this.prisma.platformSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (existing) return existing;
    return this.prisma.platformSettings.create({
      data: { id: SETTINGS_ID },
    });
  }

  private settingsPublic(
    row: Awaited<ReturnType<AdminService['getOrCreateSettings']>>,
  ) {
    return {
      id: row.id,
      defaultEmbeddingProvider: row.defaultEmbeddingProvider,
      defaultLlmProvider: row.defaultLlmProvider,
      costPer1kInputUsd: Number(row.costPer1kInputUsd),
      costPer1kOutputUsd: Number(row.costPer1kOutputUsd),
      notes: row.notes,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      runtime: {
        aiServiceUrl: this.config.get<string>('AI_SERVICE_URL') || null,
        nodeEnv: this.config.get<string>('NODE_ENV') || 'development',
        platformAdminEmails: (
          this.config.get<string>('PLATFORM_ADMIN_EMAILS') ?? ''
        )
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      },
    };
  }

  async overview(admin: AuthUser) {
    this.assertSuperAdmin(admin);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      usersTotal,
      usersActive,
      usersDisabled,
      superAdmins,
      orgsTotal,
      pendingOrgRequests,
      failedJobs,
      usageMonth,
      settings,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: { deletedAt: null, status: UserStatus.active },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, status: UserStatus.disabled },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, isPlatformAdmin: true },
      }),
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.organizationCreateRequest.count({
        where: { status: 'pending' },
      }),
      this.prisma.ingestionJob.count({ where: { status: 'failed' } }),
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: {
          tokensIn: true,
          tokensOut: true,
          costUsdEstimate: true,
          latencyMs: true,
        },
        _count: true,
      }),
      this.getOrCreateSettings(),
    ]);

    const tokensIn = usageMonth._sum.tokensIn ?? 0;
    const tokensOut = usageMonth._sum.tokensOut ?? 0;
    const loggedCost = Number(usageMonth._sum.costUsdEstimate ?? 0);
    const estimatedFromRates =
      (tokensIn / 1000) * Number(settings.costPer1kInputUsd) +
      (tokensOut / 1000) * Number(settings.costPer1kOutputUsd);
    const costUsdEstimate = loggedCost > 0 ? loggedCost : estimatedFromRates;

    return {
      users: {
        total: usersTotal,
        active: usersActive,
        disabled: usersDisabled,
        superAdmins,
      },
      organizations: { total: orgsTotal, pendingCreateRequests: pendingOrgRequests },
      jobs: { failed: failedJobs },
      usageThisMonth: {
        requests: usageMonth._count,
        tokensIn,
        tokensOut,
        costUsdEstimate: Number(costUsdEstimate.toFixed(6)),
        avgLatencyMs:
          usageMonth._count > 0
            ? Math.round((usageMonth._sum.latencyMs ?? 0) / usageMonth._count)
            : 0,
      },
      settings: this.settingsPublic(settings),
    };
  }

  async listUsers(
    admin: AuthUser,
    opts: { q?: string; status?: string; take?: number },
  ) {
    this.assertSuperAdmin(admin);
    const take = Math.min(Math.max(opts.take ?? 100, 1), 200);
    const q = opts.q?.trim();
    const status =
      opts.status === 'active' || opts.status === 'disabled'
        ? opts.status
        : undefined;

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: status as UserStatus } : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isPlatformAdmin: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { memberships: true } },
      },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      isPlatformAdmin: u.isPlatformAdmin,
      isSuperAdmin: u.isPlatformAdmin,
      emailVerifiedAt: u.emailVerifiedAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      orgCount: u._count.memberships,
    }));
  }

  async updateUser(admin: AuthUser, userId: string, dto: UpdateAdminUserDto) {
    this.assertSuperAdmin(admin);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    if (dto.isPlatformAdmin === false && user.isPlatformAdmin) {
      if (user.id === admin.id) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'You cannot remove your own Super Admin role',
        });
      }
      const others = await this.prisma.user.count({
        where: {
          deletedAt: null,
          isPlatformAdmin: true,
          id: { not: user.id },
        },
      });
      if (others === 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'At least one Super Admin is required',
        });
      }
    }

    if (dto.status === 'disabled' && user.id === admin.id) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'You cannot disable your own account',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.status !== undefined
          ? { status: dto.status as UserStatus }
          : {}),
        ...(dto.isPlatformAdmin !== undefined
          ? { isPlatformAdmin: dto.isPlatformAdmin }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isPlatformAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.audit.log({
      actorUserId: admin.id,
      action: 'admin.user.update',
      resourceType: 'user',
      resourceId: user.id,
      metadata: {
        status: updated.status,
        isPlatformAdmin: updated.isPlatformAdmin,
        name: updated.name,
      },
    });

    if (user.id !== admin.id) {
      if (dto.status === 'disabled' && user.status !== UserStatus.disabled) {
        await this.notifications.notify({
          userId: user.id,
          type: NotificationTypes.USER_DISABLED,
          title: 'Tài khoản đã bị vô hiệu hóa',
          body: 'Super Admin đã vô hiệu hóa tài khoản của bạn. Liên hệ quản trị nếu cần hỗ trợ.',
          link: '/app/settings',
          data: { by: admin.id },
        });
      }
      if (dto.status === 'active' && user.status !== UserStatus.active) {
        await this.notifications.notify({
          userId: user.id,
          type: NotificationTypes.USER_ENABLED,
          title: 'Tài khoản đã được kích hoạt lại',
          body: 'Super Admin đã kích hoạt lại tài khoản của bạn.',
          link: '/app',
          data: { by: admin.id },
        });
      }
      if (
        dto.isPlatformAdmin === true &&
        user.isPlatformAdmin === false
      ) {
        await this.notifications.notify({
          userId: user.id,
          type: NotificationTypes.SUPER_ADMIN_GRANTED,
          title: 'Bạn đã được cấp Super Admin',
          body: 'Bạn có quyền quản trị toàn hệ thống tại Super Admin.',
          link: '/app/super-admin',
          data: { by: admin.id },
        });
      }
      if (
        dto.isPlatformAdmin === false &&
        user.isPlatformAdmin === true
      ) {
        await this.notifications.notify({
          userId: user.id,
          type: NotificationTypes.SUPER_ADMIN_REVOKED,
          title: 'Quyền Super Admin đã bị gỡ',
          body: 'Bạn không còn quyền Super Admin trên hệ thống.',
          link: '/app',
          data: { by: admin.id },
        });
      }
    }

    return {
      ...updated,
      isSuperAdmin: updated.isPlatformAdmin,
    };
  }

  async platformUsage(admin: AuthUser, from?: Date, to?: Date) {
    this.assertSuperAdmin(admin);
    const settings = await this.getOrCreateSettings();
    const where: Prisma.AiUsageLogWhereInput = {
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [totals, byFeature, byProvider, byOrg, recent] = await Promise.all([
      this.prisma.aiUsageLog.aggregate({
        where,
        _sum: {
          tokensIn: true,
          tokensOut: true,
          costUsdEstimate: true,
          latencyMs: true,
        },
        _count: true,
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where,
        _sum: { tokensIn: true, tokensOut: true, costUsdEstimate: true },
        _count: true,
        orderBy: { _count: { feature: 'desc' } },
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['provider'],
        where,
        _sum: { tokensIn: true, tokensOut: true, costUsdEstimate: true },
        _count: true,
        orderBy: { _count: { provider: 'desc' } },
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['organizationId'],
        where,
        _sum: { tokensIn: true, tokensOut: true, costUsdEstimate: true },
        _count: true,
        orderBy: { _count: { organizationId: 'desc' } },
        take: 20,
      }),
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          organizationId: true,
          feature: true,
          provider: true,
          model: true,
          tokensIn: true,
          tokensOut: true,
          costUsdEstimate: true,
          latencyMs: true,
          createdAt: true,
        },
      }),
    ]);

    const orgIds = byOrg.map((o) => o.organizationId);
    const orgs = orgIds.length
      ? await this.prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const orgMap = new Map(orgs.map((o) => [o.id, o]));

    const estimateCost = (tokensIn: number, tokensOut: number, logged: number) => {
      if (logged > 0) return logged;
      return (
        (tokensIn / 1000) * Number(settings.costPer1kInputUsd) +
        (tokensOut / 1000) * Number(settings.costPer1kOutputUsd)
      );
    };

    const tokensIn = totals._sum.tokensIn ?? 0;
    const tokensOut = totals._sum.tokensOut ?? 0;
    const logged = Number(totals._sum.costUsdEstimate ?? 0);

    return {
      rates: {
        costPer1kInputUsd: Number(settings.costPer1kInputUsd),
        costPer1kOutputUsd: Number(settings.costPer1kOutputUsd),
      },
      totals: {
        requests: totals._count,
        tokensIn,
        tokensOut,
        costUsdEstimate: Number(
          estimateCost(tokensIn, tokensOut, logged).toFixed(6),
        ),
        avgLatencyMs:
          totals._count > 0
            ? Math.round((totals._sum.latencyMs ?? 0) / totals._count)
            : 0,
      },
      byFeature: byFeature.map((r) => ({
        feature: r.feature,
        requests: r._count,
        tokensIn: r._sum.tokensIn ?? 0,
        tokensOut: r._sum.tokensOut ?? 0,
        costUsdEstimate: Number(
          estimateCost(
            r._sum.tokensIn ?? 0,
            r._sum.tokensOut ?? 0,
            Number(r._sum.costUsdEstimate ?? 0),
          ).toFixed(6),
        ),
      })),
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        requests: r._count,
        tokensIn: r._sum.tokensIn ?? 0,
        tokensOut: r._sum.tokensOut ?? 0,
        costUsdEstimate: Number(
          estimateCost(
            r._sum.tokensIn ?? 0,
            r._sum.tokensOut ?? 0,
            Number(r._sum.costUsdEstimate ?? 0),
          ).toFixed(6),
        ),
      })),
      byOrganization: byOrg.map((r) => {
        const org = orgMap.get(r.organizationId);
        return {
          organizationId: r.organizationId,
          name: org?.name ?? '—',
          slug: org?.slug ?? '—',
          requests: r._count,
          tokensIn: r._sum.tokensIn ?? 0,
          tokensOut: r._sum.tokensOut ?? 0,
          costUsdEstimate: Number(
            estimateCost(
              r._sum.tokensIn ?? 0,
              r._sum.tokensOut ?? 0,
              Number(r._sum.costUsdEstimate ?? 0),
            ).toFixed(6),
          ),
        };
      }),
      recent: recent.map((r) => ({
        ...r,
        costUsdEstimate:
          r.costUsdEstimate != null
            ? Number(r.costUsdEstimate)
            : Number(
                estimateCost(r.tokensIn, r.tokensOut, 0).toFixed(6),
              ),
      })),
    };
  }

  async getPlatformSettings(admin: AuthUser) {
    this.assertSuperAdmin(admin);
    return this.settingsPublic(await this.getOrCreateSettings());
  }

  async updatePlatformSettings(
    admin: AuthUser,
    dto: UpdatePlatformSettingsDto,
  ) {
    this.assertSuperAdmin(admin);
    await this.getOrCreateSettings();
    const updated = await this.prisma.platformSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(dto.defaultEmbeddingProvider !== undefined
          ? { defaultEmbeddingProvider: dto.defaultEmbeddingProvider }
          : {}),
        ...(dto.defaultLlmProvider !== undefined
          ? { defaultLlmProvider: dto.defaultLlmProvider }
          : {}),
        ...(dto.costPer1kInputUsd !== undefined
          ? {
              costPer1kInputUsd: new Prisma.Decimal(dto.costPer1kInputUsd),
            }
          : {}),
        ...(dto.costPer1kOutputUsd !== undefined
          ? {
              costPer1kOutputUsd: new Prisma.Decimal(dto.costPer1kOutputUsd),
            }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedBy: admin.id,
      },
    });

    await this.audit.log({
      actorUserId: admin.id,
      action: 'admin.platform_settings.update',
      resourceType: 'platform_settings',
      resourceId: SETTINGS_ID,
      metadata: {
        defaultEmbeddingProvider: updated.defaultEmbeddingProvider,
        defaultLlmProvider: updated.defaultLlmProvider,
        costPer1kInputUsd: Number(updated.costPer1kInputUsd),
        costPer1kOutputUsd: Number(updated.costPer1kOutputUsd),
      },
    });

    return this.settingsPublic(updated);
  }

  async updateOrganization(
    admin: AuthUser,
    orgId: string,
    dto: UpdateAdminOrgSettingsDto,
  ) {
    this.assertSuperAdmin(admin);
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
    });
    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const prev = (org.settings || {}) as Record<string, unknown>;
    const nextSettings = { ...prev };
    if (dto.embeddingProvider !== undefined) {
      nextSettings.embedding_provider = dto.embeddingProvider;
    }
    if (dto.llmProvider !== undefined) {
      nextSettings.llm_provider = dto.llmProvider;
    }
    if (dto.aiMonthlyQuota !== undefined) {
      nextSettings.ai_monthly_quota = dto.aiMonthlyQuota;
    }

    const updated = await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.plan !== undefined ? { plan: dto.plan } : {}),
        settings: nextSettings as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, knowledgeBases: true } },
      },
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: admin.id,
      action: 'admin.organization.update',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: {
        name: updated.name,
        plan: updated.plan,
        settings: nextSettings,
      } as Prisma.InputJsonValue,
    });

    return updated;
  }

  async deleteOrganization(admin: AuthUser, orgId: string) {
    this.assertSuperAdmin(admin);
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });
    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    await this.prisma.organization.update({
      where: { id: org.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: admin.id,
      action: 'admin.organization.delete',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { name: org.name, slug: org.slug },
    });

    return { success: true, id: org.id };
  }
}
