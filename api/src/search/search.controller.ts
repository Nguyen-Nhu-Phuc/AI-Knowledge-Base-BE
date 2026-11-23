import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { SearchService } from './search.service';
import { SearchDto } from './dto/search.dto';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';

@Controller('organizations/:orgId/knowledge-bases/:kbId')
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Roles(OrgRole.viewer)
  @Post('search')
  search(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SearchDto,
  ) {
    return this.searchService.hybridSearch({
      organizationId: orgId,
      knowledgeBaseId: kbId,
      query: dto.query,
      topK: dto.topK,
      userId: user.id,
      verifiedOnly: dto.verifiedOnly,
    });
  }
}
