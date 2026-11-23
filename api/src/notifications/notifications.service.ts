import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { NotificationType } from './notification.types';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private public(row: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    data: Prisma.JsonValue;
    readAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      data: row.data,
      readAt: row.readAt,
      createdAt: row.createdAt,
      unread: row.readAt == null,
    };
  }

  async notify(input: {
    userId: string;
    type: NotificationType | string;
    title: string;
    body?: string;
    link?: string;
    data?: Record<string, unknown>;
  }) {
    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });
    return this.public(row);
  }

  async notifyMany(
    userIds: string[],
    input: {
      type: NotificationType | string;
      title: string;
      body?: string;
      link?: string;
      data?: Record<string, unknown>;
    },
  ) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return { count: 0 };
    await this.prisma.notification.createMany({
      data: unique.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      })),
    });
    return { count: unique.length };
  }

  async notifySuperAdmins(input: {
    type: NotificationType | string;
    title: string;
    body?: string;
    link?: string;
    data?: Record<string, unknown>;
    excludeUserId?: string;
  }) {
    const admins = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        isPlatformAdmin: true,
        ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
      },
      select: { id: true },
    });
    return this.notifyMany(
      admins.map((a) => a.id),
      input,
    );
  }

  async listForUser(userId: string, take = 40) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 100),
    });
    return rows.map((r) => this.public(r));
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string) {
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Notification not found',
      });
    }
    if (row.readAt) return this.public(row);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return this.public(updated);
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
