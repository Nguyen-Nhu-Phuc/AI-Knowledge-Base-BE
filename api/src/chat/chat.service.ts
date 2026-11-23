import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  FeedbackRating,
  MessageRole,
  Prisma,
} from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { AiClientService } from '../ai/ai-client.service';
import { readOrgAiPrefs } from '../ai/ai-prefs';
import { UsageService } from '../usage/usage.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ChatDto, FeedbackDto, UpdateConversationDto } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly ai: AiClientService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private writeSse(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  async listConversations(orgId: string, userId: string) {
    return this.prisma.conversation.findMany({
      where: { organizationId: orgId, userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        knowledgeBaseId: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getConversation(orgId: string, conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        userId,
        deletedAt: null,
      },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    return conversation;
  }

  async listMessages(orgId: string, conversationId: string, userId: string) {
    await this.getConversation(orgId, conversationId, userId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId, organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      include: { citations: true, feedback: true },
    });
    return messages;
  }

  async updateConversation(
    orgId: string,
    conversationId: string,
    userId: string,
    dto: UpdateConversationDto,
  ) {
    await this.getConversation(orgId, conversationId, userId);
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.status !== undefined
          ? { status: dto.status as ConversationStatus }
          : {}),
      },
    });
  }

  async softDeleteConversation(
    orgId: string,
    conversationId: string,
    userId: string,
  ) {
    await this.getConversation(orgId, conversationId, userId);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date(), status: ConversationStatus.archived },
    });
    return { success: true };
  }

  async chatStream(
    orgId: string,
    kbId: string,
    user: AuthUser,
    dto: ChatDto,
    res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const started = Date.now();
    try {
      await this.usage.assertWithinQuota(orgId);

      let botSystemPrompt: string | undefined;
      let resolvedBotId: string | undefined = dto.botId;
      if (resolvedBotId) {
        const bot = await this.prisma.bot.findFirst({
          where: {
            id: resolvedBotId,
            organizationId: orgId,
            knowledgeBaseId: kbId,
            deletedAt: null,
            status: 'active',
          },
        });
        if (!bot) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Bot not found for this knowledge base',
          });
        }
        botSystemPrompt = bot.systemPrompt;
      }

      let conversationId = dto.conversationId;
      if (conversationId) {
        const existing = await this.getConversation(
          orgId,
          conversationId,
          user.id,
        );
        if (existing.botId && !resolvedBotId) {
          resolvedBotId = existing.botId;
          const bot = await this.prisma.bot.findFirst({
            where: { id: existing.botId, deletedAt: null },
          });
          botSystemPrompt = bot?.systemPrompt;
        }
      } else {
        const created = await this.prisma.conversation.create({
          data: {
            organizationId: orgId,
            knowledgeBaseId: kbId,
            botId: resolvedBotId,
            userId: user.id,
            title: dto.message.slice(0, 80),
          },
        });
        conversationId = created.id;
        this.writeSse(res, 'conversation.created', { conversationId });
      }

      await this.prisma.message.create({
        data: {
          conversationId,
          organizationId: orgId,
          role: MessageRole.user,
          content: dto.message,
        },
      });

      this.writeSse(res, 'status', { stage: 'retrieving' });

      const topK = Number(this.config.get('CHAT_TOP_K', 8));
      let results = (
        await this.search.hybridSearch({
          organizationId: orgId,
          knowledgeBaseId: kbId,
          query: dto.message,
          topK,
          userId: user.id,
          verifiedOnly: dto.verifiedOnly,
        })
      ).results;

      const history = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 12,
      });

      const historyPayload = history
        .filter((m) => m.role !== MessageRole.system)
        .slice(0, -1)
        .map((m) => ({
          role: m.role === MessageRole.assistant ? 'assistant' : 'user',
          content: m.content,
        }));

      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { settings: true },
      });
      const prefs = readOrgAiPrefs(org?.settings);

      const researchSteps: Array<{ step: number; action: string; detail: string }> =
        [];

      // Multi-hop research: Nest orchestrates plan → retrieve → synthesize
      if (dto.research) {
        this.writeSse(res, 'status', { stage: 'researching' });
        researchSteps.push({
          step: 1,
          action: 'retrieve',
          detail: `Initial retrieval: ${results.length} chunks`,
        });
        this.writeSse(res, 'research.step', researchSteps[0]);

        try {
          const planned = await this.ai.planQueries({
            query: dto.message,
            max_queries: 3,
            provider: prefs.llmProvider,
          });
          researchSteps.push({
            step: 2,
            action: 'plan_queries',
            detail: planned.queries.join(' | '),
          });
          this.writeSse(res, 'research.step', researchSteps[1]);

          const byChunk = new Map(results.map((r) => [r.chunkId, r]));
          for (const q of planned.queries.slice(0, 3)) {
            if (q.trim().toLowerCase() === dto.message.trim().toLowerCase()) {
              continue;
            }
            const extra = await this.search.hybridSearch({
              organizationId: orgId,
              knowledgeBaseId: kbId,
              query: q,
              topK: Math.max(4, Math.floor(topK / 2)),
              userId: user.id,
              verifiedOnly: dto.verifiedOnly,
            });
            for (const hit of extra.results) {
              if (!byChunk.has(hit.chunkId)) byChunk.set(hit.chunkId, hit);
            }
          }
          results = [...byChunk.values()].slice(0, topK * 2);
          researchSteps.push({
            step: 3,
            action: 'retrieve_followups',
            detail: `Merged pool: ${results.length} chunks`,
          });
          this.writeSse(res, 'research.step', researchSteps[2]);
        } catch {
          researchSteps.push({
            step: 2,
            action: 'plan_queries',
            detail: 'Plan failed; using initial retrieval only',
          });
          this.writeSse(res, 'research.step', researchSteps[researchSteps.length - 1]);
        }
      } else {
        this.writeSse(res, 'status', { stage: 'generating' });
      }

      const chunkPayload = results.map((r) => ({
        id: r.chunkId,
        chunk_id: r.chunkId,
        document_id: r.documentId,
        document_version_id: r.documentVersionId,
        content: r.content,
        token_count: r.tokenCount,
        score: r.score,
        metadata: r.metadata,
      }));

      const enableRewrite =
        dto.rewrite ??
        this.config.get<string>('ENABLE_QUERY_REWRITE', 'true') === 'true';

      const generated = dto.research
        ? await this.ai.research({
            query: dto.message,
            chunks: chunkPayload,
            max_steps: 4,
            provider: prefs.llmProvider,
          })
        : await this.ai.generate({
            query: dto.message,
            chunks: chunkPayload,
            history: historyPayload,
            rewrite: enableRewrite,
            provider: prefs.llmProvider,
            system_prompt: botSystemPrompt,
          });

      if (dto.research && researchSteps.length) {
        const mergedSteps = [
          ...researchSteps,
          ...(('steps' in generated && Array.isArray(generated.steps)
            ? generated.steps
            : []) as Array<{ step: number; action: string; detail: string }>),
        ];
        (generated as { steps?: typeof mergedSteps }).steps = mergedSteps;
      }

      // Stream answer in small deltas for SSE UX
      const answer = generated.answer;
      const chunkSize = 48;
      for (let i = 0; i < answer.length; i += chunkSize) {
        this.writeSse(res, 'message.delta', {
          text: answer.slice(i, i + chunkSize),
        });
      }

      const allowedChunkIds = new Set(results.map((r) => r.chunkId));
      const citations = (generated.citations || [])
        .filter((c) => c.chunk_id && allowedChunkIds.has(String(c.chunk_id)))
        .map((c) => {
          const hit = results.find((r) => r.chunkId === c.chunk_id);
          return {
            documentId: hit?.documentId || String(c.document_id || ''),
            documentVersionId:
              hit?.documentVersionId || String(c.document_version_id || ''),
            chunkId: String(c.chunk_id),
            snippet: c.snippet || hit?.content.slice(0, 400) || '',
            score: c.score ?? hit?.score ?? null,
            metadata: (c.metadata || hit?.metadata || {}) as Prisma.InputJsonValue,
          };
        })
        .filter((c) => c.documentId && c.chunkId);

      this.writeSse(res, 'message.citations', { citations });

      const assistant = await this.prisma.message.create({
        data: {
          conversationId,
          organizationId: orgId,
          role: MessageRole.assistant,
          content: answer,
          tokenIn: generated.tokens_in,
          tokenOut: generated.tokens_out,
          model: generated.model,
          latencyMs: Date.now() - started,
          citations: {
            create: citations.map((c) => ({
              documentId: c.documentId,
              documentVersionId: c.documentVersionId,
              chunkId: c.chunkId,
              snippet: c.snippet,
              score: c.score ?? undefined,
              metadata: c.metadata,
            })),
          },
        },
        include: { citations: true },
      });

      await this.usage.log({
        organizationId: orgId,
        userId: user.id,
        feature: dto.research ? 'agent' : 'chat',
        provider: generated.provider,
        model: generated.model,
        tokensIn: generated.tokens_in,
        tokensOut: generated.tokens_out,
        latencyMs: Date.now() - started,
        metadata: {
          conversationId,
          knowledgeBaseId: kbId,
          citationCount: citations.length,
          steps: 'steps' in generated ? generated.steps : undefined,
        },
      });

      this.writeSse(res, 'message.completed', {
        conversationId,
        messageId: assistant.id,
        usage: {
          tokensIn: generated.tokens_in,
          tokensOut: generated.tokens_out,
          model: generated.model,
          latencyMs: Date.now() - started,
        },
        steps: 'steps' in generated ? generated.steps : undefined,
      });
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeSse(res, 'error', { message });
      res.end();
    }
  }

  async upsertFeedback(
    orgId: string,
    messageId: string,
    user: AuthUser,
    dto: FeedbackDto,
  ) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, organizationId: orgId },
      include: { conversation: true },
    });
    if (!message || message.conversation.userId !== user.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cannot feedback this message',
      });
    }

    const feedback = await this.prisma.feedback.upsert({
      where: { messageId },
      create: {
        organizationId: orgId,
        messageId,
        userId: user.id,
        rating: dto.rating as FeedbackRating,
        reason: dto.reason,
        comment: dto.comment,
      },
      update: {
        rating: dto.rating as FeedbackRating,
        reason: dto.reason,
        comment: dto.comment,
      },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'feedback.upsert',
      resourceType: 'message',
      resourceId: messageId,
      metadata: { rating: dto.rating },
    });

    return feedback;
  }
}
