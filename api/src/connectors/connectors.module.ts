import { Module } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { ConnectorSyncProcessor } from './connector-sync.processor';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [QueueModule, StorageModule],
  controllers: [ConnectorsController],
  providers: [ConnectorsService, ConnectorSyncProcessor],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
