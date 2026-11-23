import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Soft monthly AI request quota from org.settings.ai_monthly_quota */
  async assertWithinQuota(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    const settings = (org?.settings || {}) as Record<string, unknown>;
    const quota = Number(settings.ai_monthly_quota || 0);
    if (!quota || quota <= 0) return;

    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const count = await this.prisma.aiUsageLog.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: start },
        feature: { in: ['chat', 'agent', 'generate', 'research', 'slack_ask'] },
      },
    });
    if (count >= quota) {
      throw new PayloadTooLargeException({
        code: 'QUOTA_EXCEEDED',
        message: `Monthly AI quota (${quota}) exceeded`,
      });
    }
  }

  async log(input: {
    organizationId: string;
    userId?: string | null;
    feature: string;
    provider: string;
    model: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    requestId?: string;
    metadata?: Prisma.InputJsonValue;
    costUsdEstimate?: number;
  }) {
    return this.prisma.aiUsageLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
        latencyMs: input.latencyMs ?? 0,
        requestId: input.requestId,
        metadata: input.metadata ?? {},
        costUsdEstimate:
          input.costUsdEstimate !== undefined
            ? new Prisma.Decimal(input.costUsdEstimate)
            : null,
      },
    });
  }

  async summarize(orgId: string, from?: Date, to?: Date) {
    const where: Prisma.AiUsageLogWhereInput = {
      organizationId: orgId,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [totals, byFeature, byModel, recent] = await Promise.all([
      this.prisma.aiUsageLog.aggregate({
        where,
        _sum: { tokensIn: true, tokensOut: true, latencyMs: true },
        _count: true,
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where,
        _sum: { tokensIn: true, tokensOut: true },
        _count: true,
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['model'],
        where,
        _sum: { tokensIn: true, tokensOut: true },
        _count: true,
      }),
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          feature: true,
          provider: true,
          model: true,
          tokensIn: true,
          tokensOut: true,
          latencyMs: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      totals: {
        requests: totals._count,
        tokensIn: totals._sum.tokensIn ?? 0,
        tokensOut: totals._sum.tokensOut ?? 0,
        latencyMsSum: totals._sum.latencyMs ?? 0,
      },
      byFeature,
      byModel,
      recent,
    };
  }

  async analyticsOverview(orgId: string) {
    const [usage, docs, jobs, feedback] = await Promise.all([
      this.summarize(orgId),
      this.prisma.document.groupBy({
        by: ['status'],
        where: { organizationId: orgId, deletedAt: null },
        _count: true,
      }),
      this.prisma.ingestionJob.groupBy({
        by: ['status'],
        where: { organizationId: orgId },
        _count: true,
      }),
      this.prisma.feedback.groupBy({
        by: ['rating'],
        where: { organizationId: orgId },
        _count: true,
      }),
    ]);

    return {
      usage,
      documentsByStatus: docs,
      ingestionJobsByStatus: jobs,
      feedbackByRating: feedback,
    };
  }
}
