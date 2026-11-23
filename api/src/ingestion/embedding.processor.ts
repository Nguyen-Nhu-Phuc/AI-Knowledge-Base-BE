import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService } from '../ai/ai-client.service';
import { UsageService } from '../usage/usage.service';
import { EMBEDDING_QUEUE } from '../queue/queue.constants';
import type { EmbeddingQueuePayload } from '../queue/embedding-queue.service';

@Processor(EMBEDDING_QUEUE)
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly usage: UsageService,
  ) {
    super();
  }

  async process(job: Job<EmbeddingQueuePayload>) {
    const { documentVersionId, organizationId } = job.data;
    this.logger.log(`Embedding version ${documentVersionId}`);

    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentVersionId, organizationId },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, content: true },
    });

    if (chunks.length === 0) {
      return { embedded: 0 };
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const embeddingProvider =
      settings.embedding_provider === 'mock' ||
      settings.embedding_provider === 'openai' ||
      settings.embedding_provider === 'gemini'
        ? String(settings.embedding_provider)
        : undefined;

    const batchSize = 32;
    let embedded = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const started = Date.now();
      const result = await this.ai.embedTexts(
        batch.map((c) => c.content),
        embeddingProvider,
      );

      await this.usage.log({
        organizationId,
        feature: 'embed',
        provider: result.provider,
        model: result.model,
        tokensIn: result.tokens_in,
        latencyMs: Date.now() - started,
        metadata: { documentVersionId, batchFrom: i, batchSize: batch.length },
      });

      for (let j = 0; j < batch.length; j++) {
        const vectorLiteral = `[${result.embeddings[j].join(',')}]`;
        await this.prisma.$executeRaw`
          UPDATE document_chunks
          SET embedding = ${vectorLiteral}::vector
          WHERE id = ${batch[j].id}::uuid
        `;
        embedded += 1;
      }
    }

    this.logger.log(`Embedded ${embedded} chunks for version ${documentVersionId}`);
    return { embedded };
  }
}
