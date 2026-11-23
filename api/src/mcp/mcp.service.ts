import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class McpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly audit: AuditService,
  ) {}

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async createToken(orgId: string, name: string, actorUserId: string) {
    const raw = `akb_mcp_${randomBytes(24).toString('hex')}`;
    const row = await this.prisma.mcpToken.create({
      data: {
        organizationId: orgId,
        name: name.trim() || 'MCP token',
        tokenHash: this.hash(raw),
        scopes: ['search', 'get_document'],
      },
    });
    await this.audit.log({
      organizationId: orgId,
      actorUserId,
      action: 'mcp.token_create',
      resourceType: 'mcp_token',
      resourceId: row.id,
    });
    return {
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      token: raw,
      createdAt: row.createdAt,
    };
  }

  listTokens(orgId: string) {
    return this.prisma.mcpToken.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        scopes: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async revokeToken(orgId: string, tokenId: string, actorUserId: string) {
    await this.prisma.mcpToken.updateMany({
      where: { id: tokenId, organizationId: orgId },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      organizationId: orgId,
      actorUserId,
      action: 'mcp.token_revoke',
      resourceType: 'mcp_token',
      resourceId: tokenId,
    });
    return { success: true };
  }

  async resolveToken(raw: string) {
    const token = await this.prisma.mcpToken.findFirst({
      where: { tokenHash: this.hash(raw), revokedAt: null },
    });
    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid MCP token',
      });
    }
    await this.prisma.mcpToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });
    return token;
  }

  tools() {
    return {
      tools: [
        {
          name: 'search',
          description: 'Hybrid search over a knowledge base',
          inputSchema: {
            type: 'object',
            properties: {
              knowledgeBaseId: { type: 'string' },
              query: { type: 'string' },
              topK: { type: 'number' },
              verifiedOnly: { type: 'boolean' },
            },
            required: ['knowledgeBaseId', 'query'],
          },
        },
        {
          name: 'get_document',
          description: 'Get document metadata and recent chunks',
          inputSchema: {
            type: 'object',
            properties: {
              documentId: { type: 'string' },
            },
            required: ['documentId'],
          },
        },
        {
          name: 'create_task_stub',
          description: 'Stub action: record a follow-up task in audit log',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['title'],
          },
        },
      ],
    };
  }

  async callTool(
    orgId: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    if (name === 'search') {
      const kbId = String(args.knowledgeBaseId || '');
      const query = String(args.query || '');
      const result = await this.search.hybridSearch({
        organizationId: orgId,
        knowledgeBaseId: kbId,
        query,
        topK: Number(args.topK || 8),
        verifiedOnly: Boolean(args.verifiedOnly),
      });
      return {
        results: result.results.map((r) => ({
          chunkId: r.chunkId,
          documentId: r.documentId,
          title: r.title,
          score: r.score,
          snippet: r.content.slice(0, 400),
        })),
      };
    }

    if (name === 'get_document') {
      const documentId = String(args.documentId || '');
      const doc = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId: orgId, deletedAt: null },
        include: {
          currentVersion: true,
          chunks: {
            orderBy: { chunkIndex: 'asc' },
            take: 5,
            select: { id: true, chunkIndex: true, content: true, tokenCount: true },
          },
        },
      });
      if (!doc) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      return {
        id: doc.id,
        title: doc.title,
        status: doc.status,
        trustStatus: doc.trustStatus,
        kind: doc.kind,
        chunks: doc.chunks,
      };
    }

    if (name === 'create_task_stub') {
      const title = String(args.title || 'Task');
      await this.audit.log({
        organizationId: orgId,
        action: 'agent.create_task_stub',
        resourceType: 'task',
        metadata: {
          title,
          detail: String(args.detail || ''),
        },
      });
      return { ok: true, title, status: 'recorded' };
    }

    throw new NotFoundException({
      code: 'UNKNOWN_TOOL',
      message: `Unknown tool: ${name}`,
    });
  }
}
