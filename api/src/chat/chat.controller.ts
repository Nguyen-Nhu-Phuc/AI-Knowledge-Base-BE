import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatDto, FeedbackDto, UpdateConversationDto } from './dto/chat.dto';
import { OrganizationMemberGuard } from '../common/guards/organization-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { Throttle } from '@nestjs/throttler';

@Controller()
@UseGuards(OrganizationMemberGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Roles(OrgRole.viewer)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('organizations/:orgId/knowledge-bases/:kbId/chat')
  chat(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ) {
    return this.chatService.chatStream(orgId, kbId, user, dto, res);
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/conversations')
  listConversations(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.listConversations(orgId, user.id);
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/conversations/:conversationId')
  getConversation(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.getConversation(orgId, conversationId, user.id);
  }

  @Roles(OrgRole.viewer)
  @Get('organizations/:orgId/conversations/:conversationId/messages')
  listMessages(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.listMessages(orgId, conversationId, user.id);
  }

  @Roles(OrgRole.viewer)
  @Patch('organizations/:orgId/conversations/:conversationId')
  updateConversation(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.chatService.updateConversation(
      orgId,
      conversationId,
      user.id,
      dto,
    );
  }

  @Roles(OrgRole.viewer)
  @Delete('organizations/:orgId/conversations/:conversationId')
  deleteConversation(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.softDeleteConversation(
      orgId,
      conversationId,
      user.id,
    );
  }

  @Roles(OrgRole.viewer)
  @Post('organizations/:orgId/messages/:messageId/feedback')
  feedback(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: FeedbackDto,
  ) {
    return this.chatService.upsertFeedback(orgId, messageId, user, dto);
  }
}
