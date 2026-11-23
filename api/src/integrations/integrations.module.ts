import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SearchModule } from '../search/search.module';
import { AiModule } from '../ai/ai.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [SearchModule, AiModule, UsageModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
