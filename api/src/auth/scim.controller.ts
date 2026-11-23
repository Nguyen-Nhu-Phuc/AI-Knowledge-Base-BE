import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ScimService } from './scim.service';

@Controller('scim/v2/organizations/:orgId')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Public()
  @Get('ServiceProviderConfig')
  config(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Headers('authorization') authorization?: string,
  ) {
    this.scim.assertBearer(authorization);
    return this.scim.serviceProviderConfig();
  }

  @Public()
  @Get('Users')
  listUsers(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('filter') filter: string | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    this.scim.assertBearer(authorization);
    return this.scim.listUsers(orgId, filter);
  }

  @Public()
  @Post('Users')
  createUser(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    this.scim.assertBearer(authorization);
    return this.scim.createUser(orgId, body as never);
  }

  @Public()
  @Patch('Users/:userId')
  patchUser(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: { Operations?: Array<{ op: string; path?: string; value?: unknown }> },
    @Headers('authorization') authorization?: string,
  ) {
    this.scim.assertBearer(authorization);
    return this.scim.patchUser(orgId, userId, body);
  }
}
