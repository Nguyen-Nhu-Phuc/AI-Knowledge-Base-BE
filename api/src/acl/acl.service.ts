import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type OrgSettings = {
  acl_mode?: string;
  [key: string]: unknown;
};

@Injectable()
export class AclService {
  constructor(private readonly prisma: PrismaService) {}

  async getAclMode(orgId: string): Promise<'org_wide' | 'restricted'> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    const settings = (org?.settings || {}) as OrgSettings;
    return settings.acl_mode === 'restricted' ? 'restricted' : 'org_wide';
  }

  async getMemberRole(
    orgId: string,
    userId: string,
  ): Promise<OrgRole | null> {
    const m = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
      select: { role: true },
    });
    return m?.role ?? null;
  }

  private isElevated(role: OrgRole | null) {
    return role === 'owner' || role === 'admin';
  }

  /**
   * null = all documents visible (org_wide or elevated).
   * [] = none. otherwise explicit allow-list.
   */
  async visibleDocumentIds(
    orgId: string,
    kbId: string,
    userId: string,
  ): Promise<string[] | null> {
    const mode = await this.getAclMode(orgId);
    const role = await this.getMemberRole(orgId, userId);
    if (!role) return [];
    if (mode === 'org_wide' || this.isElevated(role)) return null;

    const kbGrant = await this.prisma.knowledgeBaseAcl.findFirst({
      where: {
        knowledgeBaseId: kbId,
        OR: [
          { principalType: 'user', principalId: userId },
          { principalType: 'role', principalId: role },
        ],
      },
    });

    // KB-level grant → all docs in KB
    if (kbGrant) {
      const all = await this.prisma.document.findMany({
        where: {
          organizationId: orgId,
          knowledgeBaseId: kbId,
          deletedAt: null,
        },
        select: { id: true },
      });
      return all.map((d) => d.id);
    }

    const docs = await this.prisma.document.findMany({
      where: {
        organizationId: orgId,
        knowledgeBaseId: kbId,
        deletedAt: null,
        OR: [
          { createdBy: userId },
          {
            acls: {
              some: {
                OR: [
                  { principalType: 'user', principalId: userId },
                  { principalType: 'role', principalId: role },
                ],
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    return docs.map((d) => d.id);
  }

  async assertCanReadKb(orgId: string, kbId: string, userId: string) {
    const mode = await this.getAclMode(orgId);
    const role = await this.getMemberRole(orgId, userId);
    if (!role) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Not a member of this organization',
      });
    }
    if (mode === 'org_wide' || this.isElevated(role)) return;

    const kbGrant = await this.prisma.knowledgeBaseAcl.findFirst({
      where: {
        knowledgeBaseId: kbId,
        OR: [
          { principalType: 'user', principalId: userId },
          { principalType: 'role', principalId: role },
        ],
      },
    });
    if (kbGrant) return;

    const anyDoc = await this.prisma.documentAcl.findFirst({
      where: {
        document: {
          knowledgeBaseId: kbId,
          organizationId: orgId,
          deletedAt: null,
        },
        OR: [
          { principalType: 'user', principalId: userId },
          { principalType: 'role', principalId: role },
        ],
      },
    });
    if (anyDoc) return;

    // Creator of any doc in KB
    const created = await this.prisma.document.findFirst({
      where: {
        knowledgeBaseId: kbId,
        organizationId: orgId,
        createdBy: userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (created) return;

    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'No access to this knowledge base',
    });
  }

  async listKbAcls(kbId: string) {
    return this.prisma.knowledgeBaseAcl.findMany({
      where: { knowledgeBaseId: kbId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async upsertKbAcl(params: {
    knowledgeBaseId: string;
    principalType: 'user' | 'role';
    principalId: string;
    permission: 'read' | 'write' | 'admin';
  }) {
    return this.prisma.knowledgeBaseAcl.upsert({
      where: {
        knowledgeBaseId_principalType_principalId: {
          knowledgeBaseId: params.knowledgeBaseId,
          principalType: params.principalType,
          principalId: params.principalId,
        },
      },
      create: params,
      update: { permission: params.permission },
    });
  }

  async deleteKbAcl(id: string, kbId: string) {
    return this.prisma.knowledgeBaseAcl.deleteMany({
      where: { id, knowledgeBaseId: kbId },
    });
  }

  async listDocAcls(documentId: string) {
    return this.prisma.documentAcl.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async upsertDocAcl(params: {
    documentId: string;
    principalType: 'user' | 'role';
    principalId: string;
    permission: 'read' | 'write' | 'admin';
  }) {
    return this.prisma.documentAcl.upsert({
      where: {
        documentId_principalType_principalId: {
          documentId: params.documentId,
          principalType: params.principalType,
          principalId: params.principalId,
        },
      },
      create: params,
      update: { permission: params.permission },
    });
  }

  async deleteDocAcl(id: string, documentId: string) {
    return this.prisma.documentAcl.deleteMany({
      where: { id, documentId },
    });
  }

  documentListWhere(
    visibleIds: string[] | null,
  ): Prisma.DocumentWhereInput | undefined {
    if (visibleIds === null) return undefined;
    return { id: { in: visibleIds } };
  }
}
