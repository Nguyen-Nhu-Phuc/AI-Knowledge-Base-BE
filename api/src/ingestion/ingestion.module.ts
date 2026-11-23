import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { AiModule } from '../ai/ai.module';
import { IngestionProcessor } from './ingestion.processor';
import { EmbeddingProcessor } from './embedding.processor';

@Module({
  imports: [QueueModule, AiModule],
  providers: [IngestionProcessor, EmbeddingProcessor],
})
export class IngestionModule {}
