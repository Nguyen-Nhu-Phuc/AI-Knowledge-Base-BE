import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { AiModule } from './ai/ai.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { UsageModule } from './usage/usage.module';
import { AuditModule } from './audit/audit.module';
import { ConnectorsModule } from './connectors/connectors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    AuditModule,
    StorageModule,
    QueueModule,
    AiModule,
    UsageModule,
    IngestionModule,
    ConnectorsModule,
  ],
})
export class WorkerModule {}
