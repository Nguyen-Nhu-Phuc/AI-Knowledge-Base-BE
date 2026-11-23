import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { AiModule } from '../ai/ai.module';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';

@Module({
  imports: [AiModule],
  controllers: [SearchController],
  providers: [SearchService, OrganizationMemberGuard],
  exports: [SearchService],
})
export class SearchModule {}
