import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  CONNECTOR_SYNC_QUEUE,
  EMBEDDING_QUEUE,
  INGESTION_QUEUE,
} from './queue.constants';
import { IngestionQueueService } from './ingestion-queue.service';
import { EmbeddingQueueService } from './embedding-queue.service';
import { ConnectorSyncQueueService } from './connector-sync-queue.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: Number(config.get('REDIS_PORT', 6379)),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: INGESTION_QUEUE },
      { name: EMBEDDING_QUEUE },
      { name: CONNECTOR_SYNC_QUEUE },
    ),
  ],
  providers: [
    IngestionQueueService,
    EmbeddingQueueService,
    ConnectorSyncQueueService,
  ],
  exports: [
    BullModule,
    IngestionQueueService,
    EmbeddingQueueService,
    ConnectorSyncQueueService,
  ],
})
export class QueueModule {}
