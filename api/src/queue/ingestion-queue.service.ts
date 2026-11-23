import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { INGESTION_JOB_NAME, INGESTION_QUEUE } from './queue.constants';

export type IngestionQueuePayload = {
  ingestionJobId: string;
};

@Injectable()
export class IngestionQueueService {
  private readonly logger = new Logger(IngestionQueueService.name);

  constructor(
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
  ) {}

  async enqueueParseChunk(ingestionJobId: string) {
    const job = await this.ingestionQueue.add(
      INGESTION_JOB_NAME,
      { ingestionJobId } satisfies IngestionQueuePayload,
      {
        // Unique per enqueue so retry/reprocess can re-queue the same DB job id
        jobId: `ingest-${ingestionJobId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    this.logger.log(`Enqueued ingestion job ${ingestionJobId} as ${job.id}`);
    return job;
  }
}
