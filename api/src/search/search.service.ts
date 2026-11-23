import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService } from '../ai/ai-client.service';
import { readOrgAiPrefs } from '../ai/ai-prefs';
import { UsageService } from '../usage/usage.service';
import { reciprocalRankFusion } from '../common/utils/rrf.util';
import { AclService } from '../acl/acl.service';

export type SearchHit = {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  knowledgeBaseId: string;
  content: string;
  tokenCount: number;
  metadata: Prisma.JsonValue;
  score: number;
  title?: string | null;
};

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly usage: UsageService,
    private readonly acl: AclService,
  ) {}

  private async assertKb(orgId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId: orgId, deletedAt: null },
    });
    if (!kb) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Knowledge base not found',
      });
    }
    return kb;
  }

  async hybridSearch(params: {
    organizationId: string;
    knowledgeBaseId: string;
    query: string;
    topK?: number;
    userId?: string;
    candidateMultiplier?: number;
    skipRerank?: boolean;
    verifiedOnly?: boolean;
  }): Promise<{ results: SearchHit[]; rewrittenQuery?: string }> {
    const topK = params.topK ?? 10;
    const mult = params.candidateMultiplier ?? 5;
    await this.assertKb(params.organizationId, params.knowledgeBaseId);

    const visibleDocs = params.userId
      ? await this.acl.visibleDocumentIds(
          params.organizationId,
          params.knowledgeBaseId,
          params.userId,
        )
      : null;
    if (visibleDocs && visibleDocs.length === 0) {
      return { results: [] };
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: params.organizationId },
      select: { settings: true },
    });
    const prefs = readOrgAiPrefs(org?.settings);

    const started = Date.now();
    const embed = await this.ai.embedTexts(
      [params.query],
      prefs.embeddingProvider,
    );
    const vectorLiteral = `[${embed.embeddings[0].join(',')}]`;

    await this.usage.log({
      organizationId: params.organizationId,
      userId: params.userId,
      feature: 'embed',
      provider: embed.provider,
      model: embed.model,
      tokensIn: embed.tokens_in,
      latencyMs: Date.now() - started,
      metadata: { purpose: 'search_query' },
    });

    type RawChunk = {
      id: string;
      document_id: string;
      document_version_id: string;
      knowledge_base_id: string;
      content: string;
      token_count: number;
      metadata: Prisma.JsonValue;
      score: number;
      title: string | null;
    };

    const docFilter =
      visibleDocs === null
        ? Prisma.empty
        : Prisma.sql`AND c.document_id IN (${Prisma.join(
            visibleDocs.map((id) => Prisma.sql`${id}::uuid`),
          )})`;

    const trustFilter = params.verifiedOnly
      ? Prisma.sql`AND d.trust_status = 'verified' AND (d.expires_at IS NULL OR d.expires_at > NOW())`
      : Prisma.empty;

    const candidateLimit = Math.max(topK * mult, topK);

    const vectorRows = await this.prisma.$queryRaw<RawChunk[]>`
      SELECT c.id, c.document_id, c.document_version_id, c.knowledge_base_id,
             c.content, c.token_count, c.metadata,
             (1 - (c.embedding <=> ${vectorLiteral}::vector))::float8 AS score,
             d.title
      FROM document_chunks c
      INNER JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
      INNER JOIN document_versions dv ON dv.id = c.document_version_id
      WHERE c.organization_id = ${params.organizationId}::uuid
        AND c.knowledge_base_id = ${params.knowledgeBaseId}::uuid
        AND d.current_version_id = c.document_version_id
        AND c.embedding IS NOT NULL
        AND d.status = 'ready'
        AND d.trust_status <> 'rejected'
        ${docFilter}
        ${trustFilter}
      ORDER BY c.embedding <=> ${vectorLiteral}::vector
      LIMIT ${candidateLimit}
    `;

    // Prefer websearch_to_tsquery; fall back to plainto if it errors
    let ftsRows: RawChunk[] = [];
    try {
      ftsRows = await this.prisma.$queryRaw<RawChunk[]>`
        SELECT c.id, c.document_id, c.document_version_id, c.knowledge_base_id,
               c.content, c.token_count, c.metadata,
               ts_rank(
                 to_tsvector('simple', c.content),
                 websearch_to_tsquery('simple', ${params.query})
               )::float8 AS score,
               d.title
        FROM document_chunks c
        INNER JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
        WHERE c.organization_id = ${params.organizationId}::uuid
          AND c.knowledge_base_id = ${params.knowledgeBaseId}::uuid
          AND d.current_version_id = c.document_version_id
          AND d.status = 'ready'
          AND d.trust_status <> 'rejected'
          ${docFilter}
          ${trustFilter}
          AND to_tsvector('simple', c.content) @@ websearch_to_tsquery('simple', ${params.query})
        ORDER BY score DESC
        LIMIT ${candidateLimit}
      `;
    } catch {
      ftsRows = await this.prisma.$queryRaw<RawChunk[]>`
        SELECT c.id, c.document_id, c.document_version_id, c.knowledge_base_id,
               c.content, c.token_count, c.metadata,
               ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', ${params.query}))::float8 AS score,
               d.title
        FROM document_chunks c
        INNER JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
        WHERE c.organization_id = ${params.organizationId}::uuid
          AND c.knowledge_base_id = ${params.knowledgeBaseId}::uuid
          AND d.current_version_id = c.document_version_id
          AND d.status = 'ready'
          AND d.trust_status <> 'rejected'
          ${docFilter}
          ${trustFilter}
          AND to_tsvector('simple', c.content) @@ plainto_tsquery('simple', ${params.query})
        ORDER BY score DESC
        LIMIT ${candidateLimit}
      `;
    }

    const vectorList = vectorRows.map((r) => ({ id: r.id, item: r }));
    const ftsList = ftsRows.map((r) => ({ id: r.id, item: r }));

    const fused =
      vectorList.length === 0
        ? ftsList.map((x, i) => ({
            id: x.id,
            item: x.item,
            score: 1 / (60 + i + 1),
          }))
        : reciprocalRankFusion([vectorList, ftsList], 60);

    let candidates: SearchHit[] = fused.slice(0, candidateLimit).map((f) => ({
      chunkId: f.item.id,
      documentId: f.item.document_id,
      documentVersionId: f.item.document_version_id,
      knowledgeBaseId: f.item.knowledge_base_id,
      content: f.item.content,
      tokenCount: f.item.token_count,
      metadata: f.item.metadata,
      score: f.score,
      title: f.item.title,
    }));

    // Soft-boost verified sources when not in verifiedOnly mode
    if (!params.verifiedOnly && candidates.length > 0) {
      const docIds = [...new Set(candidates.map((c) => c.documentId))];
      const trustRows = await this.prisma.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, trustStatus: true, expiresAt: true },
      });
      const boost = new Map(
        trustRows.map((d) => {
          const ok =
            d.trustStatus === 'verified' &&
            (!d.expiresAt || d.expiresAt.getTime() > Date.now());
          return [d.id, ok ? 1.15 : 1] as const;
        }),
      );
      candidates = candidates
        .map((c) => ({
          ...c,
          score: c.score * (boost.get(c.documentId) ?? 1),
        }))
        .sort((a, b) => b.score - a.score);
    }

    if (!params.skipRerank && candidates.length > 1) {
      try {
        const reranked = await this.ai.rerank({
          query: params.query,
          documents: candidates.map((c) => ({
            id: c.chunkId,
            content: c.content,
            score: c.score,
          })),
          top_n: topK,
        });
        const byId = new Map(candidates.map((c) => [c.chunkId, c]));
        const ordered: SearchHit[] = [];
        for (const r of reranked.results) {
          const id = String(r.id || r.chunk_id || '');
          const hit = byId.get(id);
          if (hit) {
            ordered.push({
              ...hit,
              score: Number(r.rerank_score ?? r.score ?? hit.score),
            });
          }
        }
        if (ordered.length) candidates = ordered;
      } catch {
        // keep RRF order
      }
    }

    return { results: candidates.slice(0, topK) };
  }
}
