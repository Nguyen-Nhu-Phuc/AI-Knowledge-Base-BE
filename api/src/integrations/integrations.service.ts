import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { AiClientService } from '../ai/ai-client.service';
import { readOrgAiPrefs } from '../ai/ai-prefs';
import { UsageService } from '../usage/usage.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly ai: AiClientService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private webBase() {
    return (
      this.config.get<string>('WEB_BASE_URL') ||
      this.config.get<string>('PUBLIC_WEB_URL') ||
      'http://127.0.0.1:3000'
    ).replace(/\/$/, '');
  }

  verifySlackSignature(
    signingSecret: string,
    timestamp: string,
    rawBody: string,
    signature: string,
  ) {
    if (!signingSecret) return true;
    const base = `v0:${timestamp}:${rawBody}`;
    const digest =
      'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  async handleSlackCommand(params: {
    orgId: string;
    kbId?: string;
    text: string;
    userName?: string;
    teamId?: string;
    channelId?: string;
  }) {
    const org = await this.prisma.organization.findFirst({
      where: { id: params.orgId, deletedAt: null },
    });
    if (!org) {
      throw new BadRequestException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const settings = (org.settings || {}) as Record<string, unknown>;
    const defaultKb =
      params.kbId ||
      String(settings.slack_default_kb_id || settings.default_kb_id || '');
    if (!defaultKb) {
      return {
        response_type: 'ephemeral',
        text: 'No knowledge base configured. Set org settings.slack_default_kb_id.',
      };
    }

    const query = (params.text || '').trim();
    if (!query) {
      return {
        response_type: 'ephemeral',
        text: 'Usage: /ask <question>',
      };
    }

    const prefs = readOrgAiPrefs(org.settings);
    const { results } = await this.search.hybridSearch({
      organizationId: params.orgId,
      knowledgeBaseId: defaultKb,
      query,
      topK: 6,
    });

    const started = Date.now();
    const gen = await this.ai.generate({
      query,
      chunks: results.map((r) => ({
        chunk_id: r.chunkId,
        document_id: r.documentId,
        content: r.content,
        score: r.score,
        title: r.title,
      })),
      provider: prefs.llmProvider,
    });

    await this.usage.log({
      organizationId: params.orgId,
      feature: 'slack_ask',
      provider: gen.provider,
      model: gen.model,
      tokensIn: gen.tokens_in,
      tokensOut: gen.tokens_out,
      latencyMs: Date.now() - started,
      metadata: { channelId: params.channelId, teamId: params.teamId },
    });

    await this.audit.log({
      organizationId: params.orgId,
      action: 'integrations.slack_ask',
      resourceType: 'knowledge_base',
      resourceId: defaultKb,
      metadata: { query, userName: params.userName },
    });

    const chatUrl = `${this.webBase()}/app/chat?kbId=${defaultKb}&q=${encodeURIComponent(query)}`;
    const citations = (gen.citations || [])
      .slice(0, 3)
      .map(
        (c, i) =>
          `[${i + 1}] ${c.document_id || c.snippet?.slice(0, 40) || 'source'}`,
      )
      .join('\n');

    return {
      response_type: 'in_channel',
      text: `${gen.answer}\n\n${citations ? `Sources:\n${citations}\n` : ''}Open in app: ${chatUrl}`,
    };
  }

  async handleTeamsMessage(params: {
    orgId: string;
    kbId?: string;
    text: string;
  }) {
    const slackLike = await this.handleSlackCommand({
      orgId: params.orgId,
      kbId: params.kbId,
      text: params.text,
    });
    return {
      type: 'message',
      text: slackLike.text,
    };
  }

  assertIntegrationSecret(headerSecret?: string) {
    const expected =
      this.config.get<string>('INTEGRATIONS_WEBHOOK_SECRET') ||
      this.config.get<string>('SERVICE_SECRET') ||
      '';
    if (!expected) return;
    if (!headerSecret || headerSecret !== expected) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid integration secret',
      });
    }
  }
}
