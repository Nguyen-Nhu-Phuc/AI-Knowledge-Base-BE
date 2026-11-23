import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AuditInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput) {
    return this.prisma.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? {},
      },
    });
  }
}
