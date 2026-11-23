import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ScimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  assertBearer(authorization?: string) {
    const expected = this.config.get<string>('SCIM_BEARER_TOKEN') || '';
    if (!expected) {
      throw new UnauthorizedException({
        code: 'SCIM_NOT_CONFIGURED',
        message: 'Set SCIM_BEARER_TOKEN',
      });
    }
    const token = authorization?.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : '';
    if (token !== expected) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid SCIM bearer token',
      });
    }
  }

  async listUsers(orgId: string, filter?: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: { user: true },
    });
    let rows = members.map((m) => this.toScimUser(m.user, m.role));
    if (filter?.includes('userName eq')) {
      const match = filter.match(/userName eq "([^"]+)"/i);
      if (match) {
        const email = match[1].toLowerCase();
        rows = rows.filter((r) => r.userName.toLowerCase() === email);
      }
    }
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: rows.length,
      Resources: rows,
    };
  }

  async createUser(
    orgId: string,
    body: {
      userName?: string;
      displayName?: string;
      active?: boolean;
      emails?: Array<{ value: string }>;
      name?: { formatted?: string };
    },
  ) {
    const email = (
      body.userName ||
      body.emails?.[0]?.value ||
      ''
    ).toLowerCase();
    const name =
      body.displayName || body.name?.formatted || email.split('@')[0];
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
          emailVerifiedAt: new Date(),
          status: body.active === false ? 'disabled' : 'active',
        },
      });
    }
    await this.prisma.organizationMember.upsert({
      where: {
        organizationId_userId: { organizationId: orgId, userId: user.id },
      },
      create: {
        organizationId: orgId,
        userId: user.id,
        role: OrgRole.member,
      },
      update: {},
    });
    await this.audit.log({
      organizationId: orgId,
      action: 'scim.user_create',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { email },
    });
    return this.toScimUser(user, OrgRole.member);
  }

  async patchUser(
    orgId: string,
    userId: string,
    body: { Operations?: Array<{ op: string; path?: string; value?: unknown }> },
  ) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId },
      include: { user: true },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'User not in organization',
      });
    }

    let active = member.user.status === 'active';
    for (const op of body.Operations || []) {
      if (
        op.path?.toLowerCase() === 'active' ||
        (typeof op.value === 'object' &&
          op.value &&
          'active' in (op.value as object))
      ) {
        const val =
          typeof op.value === 'boolean'
            ? op.value
            : Boolean((op.value as { active?: boolean })?.active);
        active = val;
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { status: active ? 'active' : 'disabled' },
    });

    await this.audit.log({
      organizationId: orgId,
      action: 'scim.user_patch',
      resourceType: 'user',
      resourceId: userId,
      metadata: { active },
    });

    return this.toScimUser(user, member.role);
  }

  private toScimUser(
    user: {
      id: string;
      email: string;
      name: string;
      status: string;
    },
    role: OrgRole,
  ) {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      userName: user.email,
      displayName: user.name,
      active: user.status === 'active',
      emails: [{ value: user.email, primary: true }],
      meta: {
        resourceType: 'User',
        role,
      },
    };
  }

  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'SCIM_BEARER_TOKEN',
        },
      ],
    };
  }
}
