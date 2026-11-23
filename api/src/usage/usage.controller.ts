import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { IsDateString, IsOptional } from 'class-validator';
import { UsageService } from './usage.service';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

class UsageQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

@Controller('organizations/:orgId')
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Roles(OrgRole.admin)
  @Get('usage')
  usage(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: UsageQueryDto,
  ) {
    return this.usageService.summarize(
      orgId,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Roles(OrgRole.admin)
  @Get('analytics/overview')
  analytics(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.usageService.analyticsOverview(orgId);
  }
}
