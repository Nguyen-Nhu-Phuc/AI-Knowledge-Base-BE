import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeBaseStatus, OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import type { AuthUser } from '../auth/types/auth-user.type';

@Injectable()
export class KnowledgeBasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private public(kb: {
    id: string;
    organizationId: string;
    name: string;
    description: string | null;
    status: KnowledgeBaseStatus;
    embeddingModel: string;
    embeddingDimensions: number;
    settings: Prisma.JsonValue;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: kb.id,
      organizationId: kb.organizationId,
      name: kb.name,
      description: kb.description,
      status: kb.status,
      embeddingModel: kb.embeddingModel,
      embeddingDimensions: kb.embeddingDimensions,
      settings: kb.settings,
      createdBy: kb.createdBy,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    };
  }

  private async assertCanCreate(orgId: string, role: OrgRole) {
    if (role === OrgRole.owner || role === OrgRole.admin) {
      return;
    }
    if (role === OrgRole.viewer) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Viewers cannot create knowledge bases',
      });
    }

    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { settings: true },
    });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    if (settings.allow_member_create_kb === true) {
      return;
    }

    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Only owner/admin can create knowledge bases',
    });
  }

  async create(
    orgId: string,
    user: AuthUser,
    role: OrgRole,
    dto: CreateKnowledgeBaseDto,
  ) {
    await this.assertCanCreate(orgId, role);

    const name = dto.name.trim();
    const duplicate = await this.prisma.knowledgeBase.findFirst({
      where: {
        organizationId: orgId,
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Knowledge base name already exists in this organization',
      });
    }

    const kb = await this.prisma.knowledgeBase.create({
      data: {
        organizationId: orgId,
        name,
        description: dto.description?.trim() || null,
        createdBy: user.id,
        settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'knowledge_base.create',
      resourceType: 'knowledge_base',
      resourceId: kb.id,
    });

    return this.public(kb);
  }

  async list(orgId: string, role: OrgRole) {
    const includeArchived = role === OrgRole.owner || role === OrgRole.admin;
    const items = await this.prisma.knowledgeBase.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(includeArchived ? {} : { status: KnowledgeBaseStatus.active }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((kb) => this.public(kb));
  }

  async getOne(orgId: string, kbId: string, role: OrgRole) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId: orgId, deletedAt: null },
    });
    if (!kb) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Knowledge base not found',
      });
    }
    if (
      kb.status === KnowledgeBaseStatus.archived &&
      role !== OrgRole.owner &&
      role !== OrgRole.admin
    ) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Knowledge base not found',
      });
    }
    return this.public(kb);
  }

  async update(
    orgId: string,
    kbId: string,
    user: AuthUser,
    dto: UpdateKnowledgeBaseDto,
  ) {
    await this.getOne(orgId, kbId, OrgRole.admin);

    if (dto.name) {
      const name = dto.name.trim();
      const duplicate = await this.prisma.knowledgeBase.findFirst({
        where: {
          organizationId: orgId,
          name: { equals: name, mode: 'insensitive' },
          deletedAt: null,
          NOT: { id: kbId },
        },
      });
      if (duplicate) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Knowledge base name already exists in this organization',
        });
      }
    }

    const kb = await this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.settings !== undefined
          ? { settings: dto.settings as Prisma.InputJsonValue }
          : {}),
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'knowledge_base.update',
      resourceType: 'knowledge_base',
      resourceId: kbId,
    });

    return this.public(kb);
  }

  async softDelete(orgId: string, kbId: string, user: AuthUser) {
    await this.getOne(orgId, kbId, OrgRole.admin);

    await this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: { deletedAt: new Date(), status: KnowledgeBaseStatus.archived },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'knowledge_base.delete',
      resourceType: 'knowledge_base',
      resourceId: kbId,
    });

    return { success: true };
  }
}
