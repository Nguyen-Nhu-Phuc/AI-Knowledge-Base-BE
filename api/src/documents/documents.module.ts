import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, OrganizationMemberGuard],
  exports: [DocumentsService],
})
export class DocumentsModule {}
