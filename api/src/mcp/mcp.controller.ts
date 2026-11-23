import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { OrgRole } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { McpService } from './mcp.service';

class CreateMcpTokenDto {
  @IsString()
  @MinLength(2)
  name!: string;
}

class McpCallDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsObject()
  arguments?: Record<string, unknown>;
}

@Controller()
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin, OrgRole.owner)
  @Get('organizations/:orgId/mcp/tokens')
  listTokens(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.mcp.listTokens(orgId);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin, OrgRole.owner)
  @Post('organizations/:orgId/mcp/tokens')
  createToken(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMcpTokenDto,
  ) {
    return this.mcp.createToken(orgId, dto.name, user.id);
  }

  @UseGuards(OrganizationMemberGuard, RolesGuard)
  @Roles(OrgRole.admin, OrgRole.owner)
  @Delete('organizations/:orgId/mcp/tokens/:tokenId')
  revokeToken(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mcp.revokeToken(orgId, tokenId, user.id);
  }

  @Public()
  @Get('mcp/tools')
  tools() {
    return this.mcp.tools();
  }

  @Public()
  @Post('mcp/:orgId/call')
  async call(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-mcp-token') mcpToken: string | undefined,
    @Body() dto: McpCallDto,
  ) {
    const raw =
      mcpToken ||
      (authorization?.toLowerCase().startsWith('bearer ')
        ? authorization.slice(7).trim()
        : '');
    const token = await this.mcp.resolveToken(raw);
    if (token.organizationId !== orgId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Token organization mismatch',
      });
    }
    return this.mcp.callTool(orgId, dto.name, dto.arguments || {});
  }
}
