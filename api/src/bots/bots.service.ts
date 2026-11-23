import { Injectable, NotFoundException } from '@nestjs/common';
import { BotStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.type';

@Injectable()
export class BotsService {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string) {
    return this.prisma.bot.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        knowledgeBase: { select: { id: true, name: true, status: true } },
      },
    });
  }

  async create(
    orgId: string,
    user: AuthUser,
    body: {
      knowledgeBaseId: string;
      name: string;
      description?: string;
      systemPrompt?: string;
    },
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: body.knowledgeBaseId,
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!kb) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Knowledge base not found',
      });
    }
    return this.prisma.bot.create({
      data: {
        organizationId: orgId,
        knowledgeBaseId: body.knowledgeBaseId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        systemPrompt:
          body.systemPrompt?.trim() ||
          'You are an enterprise knowledge assistant. Answer ONLY using the provided context and cite sources with [n].',
        createdBy: user.id,
      },
    });
  }

  async update(
    orgId: string,
    botId: string,
    body: {
      name?: string;
      description?: string | null;
      systemPrompt?: string;
      status?: 'active' | 'archived';
      knowledgeBaseId?: string;
    },
  ) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, organizationId: orgId, deletedAt: null },
    });
    if (!bot) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Bot not found',
      });
    }
    if (body.knowledgeBaseId) {
      const kb = await this.prisma.knowledgeBase.findFirst({
        where: {
          id: body.knowledgeBaseId,
          organizationId: orgId,
          deletedAt: null,
        },
      });
      if (!kb) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Knowledge base not found',
        });
      }
    }
    return this.prisma.bot.update({
      where: { id: botId },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.systemPrompt !== undefined
          ? { systemPrompt: body.systemPrompt.trim() }
          : {}),
        ...(body.status !== undefined
          ? { status: body.status as BotStatus }
          : {}),
        ...(body.knowledgeBaseId
          ? { knowledgeBaseId: body.knowledgeBaseId }
          : {}),
      },
    });
  }

  async softDelete(orgId: string, botId: string) {
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, organizationId: orgId, deletedAt: null },
    });
    if (!bot) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Bot not found',
      });
    }
    await this.prisma.bot.update({
      where: { id: botId },
      data: { deletedAt: new Date(), status: BotStatus.archived },
    });
    return { success: true };
  }

  async getActive(orgId: string, botId: string) {
    const bot = await this.prisma.bot.findFirst({
      where: {
        id: botId,
        organizationId: orgId,
        deletedAt: null,
        status: BotStatus.active,
      },
    });
    if (!bot) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Bot not found',
      });
    }
    return bot;
  }
}
