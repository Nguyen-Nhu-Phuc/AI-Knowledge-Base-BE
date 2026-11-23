import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SearchModule } from '../search/search.module';
import { AiModule } from '../ai/ai.module';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';

@Module({
  imports: [SearchModule, AiModule],
  controllers: [ChatController],
  providers: [ChatService, OrganizationMemberGuard],
})
export class ChatModule {}
