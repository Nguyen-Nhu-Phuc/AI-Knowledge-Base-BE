import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationMemberGuard],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
