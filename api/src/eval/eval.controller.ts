import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { OrgRole } from '@prisma/client';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { EvalService } from './eval.service';

class RunEvalDto {
  @IsOptional()
  @IsUUID()
  knowledgeBaseId?: string;
}

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class EvalController {
  constructor(private readonly evalService: EvalService) {}

  @Roles(OrgRole.admin, OrgRole.owner)
  @Get('organizations/:orgId/eval-runs')
  list(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.evalService.list(orgId);
  }

  @Roles(OrgRole.admin, OrgRole.owner)
  @Post('organizations/:orgId/eval-runs')
  run(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RunEvalDto,
  ) {
    return this.evalService.run(orgId, dto.knowledgeBaseId, user.id);
  }
}
