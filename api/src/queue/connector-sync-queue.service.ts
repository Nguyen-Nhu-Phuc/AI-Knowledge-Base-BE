import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  CONNECTOR_SYNC_JOB_NAME,
  CONNECTOR_SYNC_QUEUE,
} from './queue.constants';

@Injectable()
export class ConnectorSyncQueueService {
  constructor(
    @InjectQueue(CONNECTOR_SYNC_QUEUE) private readonly queue: Queue,
  ) {}

  enqueue(runId: string) {
    return this.queue.add(
      CONNECTOR_SYNC_JOB_NAME,
      { runId },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
  }
}
