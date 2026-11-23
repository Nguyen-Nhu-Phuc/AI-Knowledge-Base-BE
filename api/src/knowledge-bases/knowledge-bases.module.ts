import { Module } from '@nestjs/common';
import { KnowledgeBasesController } from './knowledge-bases.controller';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';

@Module({
  controllers: [KnowledgeBasesController],
  providers: [KnowledgeBasesService, OrganizationMemberGuard],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
