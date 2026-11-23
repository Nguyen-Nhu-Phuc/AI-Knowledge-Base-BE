import { Injectable } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EntitiesService {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string, type?: EntityType) {
    return this.prisma.entity.findMany({
      where: {
        organizationId: orgId,
        ...(type ? { type } : {}),
      },
      include: {
        _count: { select: { links: true } },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  async relatedToDocument(orgId: string, documentId: string) {
    return this.prisma.entityLink.findMany({
      where: { organizationId: orgId, documentId },
      include: { entity: true },
    });
  }

  async upsertPersonFromMember(orgId: string, userId: string, name: string) {
    const entity = await this.prisma.entity.upsert({
      where: {
        organizationId_type_name: {
          organizationId: orgId,
          type: EntityType.person,
          name,
        },
      },
      create: {
        organizationId: orgId,
        type: EntityType.person,
        name,
        externalKey: userId,
        metadata: { userId },
      },
      update: { externalKey: userId, metadata: { userId } },
    });
    await this.prisma.entityLink.create({
      data: {
        organizationId: orgId,
        entityId: entity.id,
        userId,
        relation: 'member',
        weight: 1,
      },
    });
    return entity;
  }

  /** Index org members as person entities + extract @mentions from doc titles. */
  async rebuildGraph(orgId: string) {
    await this.prisma.entityLink.deleteMany({ where: { organizationId: orgId } });

    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    let people = 0;
    for (const m of members) {
      await this.upsertPersonFromMember(orgId, m.user.id, m.user.name);
      people += 1;
    }

    const docs = await this.prisma.document.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, title: true, createdBy: true, ownerUserId: true },
      take: 500,
    });

    let links = 0;
    for (const doc of docs) {
      const ownerId = doc.ownerUserId || doc.createdBy;
      const owner = members.find((m) => m.user.id === ownerId);
      if (owner) {
        const entity = await this.prisma.entity.findFirst({
          where: {
            organizationId: orgId,
            type: EntityType.person,
            name: owner.user.name,
          },
        });
        if (entity) {
          await this.prisma.entityLink.create({
            data: {
              organizationId: orgId,
              entityId: entity.id,
              documentId: doc.id,
              userId: ownerId,
              relation: 'owns',
              weight: 1,
            },
          });
          links += 1;
        }
      }

      const mention = doc.title.match(/@([\w.\-]+)/);
      if (mention) {
        const topic = mention[1];
        const entity = await this.prisma.entity.upsert({
          where: {
            organizationId_type_name: {
              organizationId: orgId,
              type: EntityType.topic,
              name: topic,
            },
          },
          create: {
            organizationId: orgId,
            type: EntityType.topic,
            name: topic,
          },
          update: {},
        });
        await this.prisma.entityLink.create({
          data: {
            organizationId: orgId,
            entityId: entity.id,
            documentId: doc.id,
            relation: 'mentioned',
            weight: 0.5,
            metadata: { from: 'title' } as Prisma.InputJsonValue,
          },
        });
        links += 1;
      }
    }

    return { people, links, documents: docs.length };
  }

  searchPeople(orgId: string, q: string) {
    return this.prisma.entity.findMany({
      where: {
        organizationId: orgId,
        type: EntityType.person,
        name: { contains: q, mode: 'insensitive' },
      },
      take: 20,
      include: {
        links: {
          where: { documentId: { not: null } },
          take: 5,
          include: {
            document: { select: { id: true, title: true, knowledgeBaseId: true } },
          },
        },
      },
    });
  }
}
