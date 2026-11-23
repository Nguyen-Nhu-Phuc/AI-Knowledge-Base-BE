import { Module } from '@nestjs/common';
import { UsageController } from '../usage/usage.controller';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';

@Module({
  controllers: [UsageController],
  providers: [OrganizationMemberGuard],
})
export class AnalyticsModule {}
