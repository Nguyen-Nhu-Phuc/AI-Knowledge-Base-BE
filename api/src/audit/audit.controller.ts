import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles(OrgRole.admin, OrgRole.owner)
  @Get('organizations/:orgId/audit-logs')
  async list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: AuditQueryDto,
  ) {
    const limit = query.limit ?? 50;
    return this.prisma.auditLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: { select: { id: true, email: true, name: true } },
      },
    });
  }
}
