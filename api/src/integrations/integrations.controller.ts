import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly config: ConfigService,
  ) {}

  /** Slack slash command: /ask … */
  @Public()
  @Post('slack/commands/:orgId')
  async slackCommand(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('kbId') kbId: string | undefined,
    @Body() body: Record<string, string>,
    @Headers('x-slack-signature') signature: string | undefined,
    @Headers('x-slack-request-timestamp') timestamp: string | undefined,
    @Headers('x-akb-integration-secret') secret: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const signingSecret = this.config.get<string>('SLACK_SIGNING_SECRET') || '';
    if (signingSecret && signature && timestamp) {
      const raw =
        typeof req.rawBody === 'string'
          ? req.rawBody
          : Buffer.isBuffer(req.rawBody)
            ? req.rawBody.toString('utf8')
            : new URLSearchParams(body as Record<string, string>).toString();
      const ok = this.integrations.verifySlackSignature(
        signingSecret,
        timestamp,
        raw,
        signature,
      );
      if (!ok) {
        this.integrations.assertIntegrationSecret(secret);
      }
    } else {
      this.integrations.assertIntegrationSecret(secret);
    }

    return this.integrations.handleSlackCommand({
      orgId,
      kbId: kbId || body.kbId,
      text: body.text || '',
      userName: body.user_name,
      teamId: body.team_id,
      channelId: body.channel_id,
    });
  }

  /** Microsoft Teams outgoing webhook / bot message */
  @Public()
  @Post('teams/:orgId')
  async teamsMessage(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('kbId') kbId: string | undefined,
    @Body()
    body: { text?: string; type?: string },
    @Headers('x-akb-integration-secret') secret: string | undefined,
  ) {
    this.integrations.assertIntegrationSecret(secret);
    const text = (body.text || '').replace(/^<at>[^<]*<\/at>\s*/i, '').trim();
    return this.integrations.handleTeamsMessage({
      orgId,
      kbId,
      text,
    });
  }
}
