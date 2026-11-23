import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EMBEDDING_JOB_NAME, EMBEDDING_QUEUE } from './queue.constants';

export type EmbeddingQueuePayload = {
  documentVersionId: string;
  organizationId: string;
};

@Injectable()
export class EmbeddingQueueService {
  private readonly logger = new Logger(EmbeddingQueueService.name);

  constructor(
    @InjectQueue(EMBEDDING_QUEUE) private readonly embeddingQueue: Queue,
  ) {}

  async enqueueEmbedVersion(documentVersionId: string, organizationId: string) {
    const job = await this.embeddingQueue.add(
      EMBEDDING_JOB_NAME,
      { documentVersionId, organizationId } satisfies EmbeddingQueuePayload,
      {
        jobId: `embed-${documentVersionId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    this.logger.log(`Enqueued embedding for version ${documentVersionId}`);
    return job;
  }
}
