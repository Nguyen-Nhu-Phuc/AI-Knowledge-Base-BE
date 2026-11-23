import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  DocumentStatus,
  IngestionJobStatus,
  ParseStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AiClientService } from '../ai/ai-client.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { INGESTION_QUEUE } from '../queue/queue.constants';
import type { IngestionQueuePayload } from '../queue/ingestion-queue.service';

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiClientService,
    private readonly embeddingQueue: EmbeddingQueueService,
  ) {
    super();
  }

  async process(job: Job<IngestionQueuePayload>): Promise<{
    chunkCount: number;
  }> {
    const { ingestionJobId } = job.data;
    this.logger.log(`Processing ingestion ${ingestionJobId}`);

    const ingestion = await this.prisma.ingestionJob.findUnique({
      where: { id: ingestionJobId },
      include: {
        document: true,
        documentVersion: true,
      },
    });

    if (!ingestion) {
      throw new Error(`Ingestion job ${ingestionJobId} not found`);
    }

    if (ingestion.document.deletedAt) {
      await this.failJob(ingestionJobId, ingestion.documentId, ingestion.documentVersionId, 'Document deleted');
      return { chunkCount: 0 };
    }

    await this.prisma.$transaction([
      this.prisma.ingestionJob.update({
        where: { id: ingestionJobId },
        data: {
          status: IngestionJobStatus.running,
          startedAt: new Date(),
          errorMessage: null,
          attempts: { increment: 1 },
        },
      }),
      this.prisma.document.update({
        where: { id: ingestion.documentId },
        data: { status: DocumentStatus.processing },
      }),
      this.prisma.documentVersion.update({
        where: { id: ingestion.documentVersionId },
        data: { parseStatus: ParseStatus.processing, errorMessage: null },
      }),
    ]);

    try {
      const fileBuffer = await this.storage.downloadObject(
        ingestion.documentVersion.storageKey,
      );
      const filename =
        ingestion.documentVersion.originalFilename ||
        ingestion.document.title ||
        'document';

      const parsed = await this.ai.parseAndChunk({
        fileBuffer,
        filename,
        mimeType: ingestion.documentVersion.mimeType,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({
          where: { documentVersionId: ingestion.documentVersionId },
        });

        if (parsed.chunks.length > 0) {
          await tx.documentChunk.createMany({
            data: parsed.chunks.map((chunk) => ({
              organizationId: ingestion.organizationId,
              knowledgeBaseId: ingestion.document.knowledgeBaseId,
              documentId: ingestion.documentId,
              documentVersionId: ingestion.documentVersionId,
              chunkIndex: chunk.chunk_index,
              content: chunk.content,
              tokenCount: chunk.token_count,
              metadata: chunk.metadata as Prisma.InputJsonValue,
            })),
          });
        }

        await tx.documentVersion.update({
          where: { id: ingestion.documentVersionId },
          data: {
            parseStatus: ParseStatus.succeeded,
            pageCount: parsed.page_count ?? null,
            errorMessage: null,
          },
        });

        await tx.document.update({
          where: { id: ingestion.documentId },
          data: { status: DocumentStatus.ready },
        });

        await tx.ingestionJob.update({
          where: { id: ingestionJobId },
          data: {
            status: IngestionJobStatus.succeeded,
            finishedAt: new Date(),
            errorMessage: null,
          },
        });
      });

      if (parsed.chunk_count > 0) {
        await this.embeddingQueue.enqueueEmbedVersion(
          ingestion.documentVersionId,
          ingestion.organizationId,
        );
      }

      this.logger.log(
        `Ingestion ${ingestionJobId} succeeded with ${parsed.chunk_count} chunks`,
      );
      return { chunkCount: parsed.chunk_count };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ingestion ${ingestionJobId} failed: ${message}`);
      await this.failJob(
        ingestionJobId,
        ingestion.documentId,
        ingestion.documentVersionId,
        message,
      );
      throw error;
    }
  }

  private async failJob(
    ingestionJobId: string,
    documentId: string,
    documentVersionId: string,
    message: string,
  ) {
    await this.prisma.$transaction([
      this.prisma.ingestionJob.update({
        where: { id: ingestionJobId },
        data: {
          status: IngestionJobStatus.failed,
          finishedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      }),
      this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.failed },
      }),
      this.prisma.documentVersion.update({
        where: { id: documentVersionId },
        data: {
          parseStatus: ParseStatus.failed,
          errorMessage: message.slice(0, 2000),
        },
      }),
    ]);
  }
}
