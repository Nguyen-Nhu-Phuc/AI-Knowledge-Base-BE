import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CONNECTOR_SYNC_QUEUE } from '../queue/queue.constants';
import { ConnectorsService } from './connectors.service';

@Processor(CONNECTOR_SYNC_QUEUE)
export class ConnectorSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ConnectorSyncProcessor.name);

  constructor(private readonly connectors: ConnectorsService) {
    super();
  }

  async process(job: Job<{ runId: string }>) {
    this.logger.log(`Connector sync run ${job.data.runId}`);
    await this.connectors.runSync(job.data.runId);
  }
}
