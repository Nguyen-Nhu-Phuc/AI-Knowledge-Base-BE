import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';

type OidcProvider = 'google' | 'microsoft';

@Injectable()
export class OidcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  private providerConfig(provider: OidcProvider) {
    if (provider === 'google') {
      return {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        clientId: this.config.get<string>('OIDC_GOOGLE_CLIENT_ID') || '',
        clientSecret: this.config.get<string>('OIDC_GOOGLE_CLIENT_SECRET') || '',
        scope: 'openid email profile',
      };
    }
    return {
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
      clientId: this.config.get<string>('OIDC_MICROSOFT_CLIENT_ID') || '',
      clientSecret:
        this.config.get<string>('OIDC_MICROSOFT_CLIENT_SECRET') || '',
      scope: 'openid email profile',
    };
  }

  private redirectUri() {
    const api =
      this.config.get<string>('API_PUBLIC_URL') ||
      `http://127.0.0.1:${this.config.get('PORT', 3001)}`;
    const prefix = this.config.get<string>('API_PREFIX', 'api/v1');
    return `${api.replace(/\/$/, '')}/${prefix}/auth/oidc/callback`;
  }

  begin(provider: OidcProvider) {
    const cfg = this.providerConfig(provider);
    if (!cfg.clientId) {
      throw new BadRequestException({
        code: 'OIDC_NOT_CONFIGURED',
        message: `Set OIDC_${provider.toUpperCase()}_CLIENT_ID / _CLIENT_SECRET`,
      });
    }
    const state = randomBytes(16).toString('hex');
    const url = new URL(cfg.authUrl);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', cfg.scope);
    url.searchParams.set('state', `${provider}:${state}`);
    return { authorizationUrl: url.toString(), state: `${provider}:${state}` };
  }

  async callback(
    code: string,
    state: string,
    res: Response,
    meta: { ip?: string | null; userAgent?: string | null },
  ) {
    const provider = (state.split(':')[0] || '') as OidcProvider;
    if (provider !== 'google' && provider !== 'microsoft') {
      throw new BadRequestException({
        code: 'INVALID_STATE',
        message: 'Invalid OIDC state',
      });
    }
    const cfg = this.providerConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new BadRequestException({
        code: 'OIDC_NOT_CONFIGURED',
        message: 'OIDC provider not configured',
      });
    }

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new UnauthorizedException({
        code: 'OIDC_TOKEN_FAILED',
        message: 'Failed to exchange OIDC code',
      });
    }
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) {
      throw new UnauthorizedException({
        code: 'OIDC_TOKEN_FAILED',
        message: 'No access token from IdP',
      });
    }

    const infoRes = await fetch(cfg.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) {
      throw new UnauthorizedException({
        code: 'OIDC_USERINFO_FAILED',
        message: 'Failed to load userinfo',
      });
    }
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
    };
    if (!info.sub || !info.email) {
      throw new UnauthorizedException({
        code: 'OIDC_USERINFO_FAILED',
        message: 'IdP userinfo missing sub/email',
      });
    }

    return this.loginFromProfile(
      provider,
      info.sub,
      info.email,
      info.name || info.email.split('@')[0],
      res,
      meta,
    );
  }

  /** Dev/stub: link email as OIDC without real IdP (for local demos). */
  async stubLogin(
    provider: OidcProvider,
    email: string,
    name: string,
    res: Response,
    meta: { ip?: string | null; userAgent?: string | null },
  ) {
    if (this.config.get('OIDC_ALLOW_STUB') !== 'true') {
      throw new BadRequestException({
        code: 'OIDC_STUB_DISABLED',
        message: 'Set OIDC_ALLOW_STUB=true for local OIDC stub',
      });
    }
    const subject = createHash('sha256')
      .update(`${provider}:${email.toLowerCase()}`)
      .digest('hex')
      .slice(0, 32);
    return this.loginFromProfile(provider, subject, email, name, res, meta);
  }

  private async loginFromProfile(
    provider: string,
    subject: string,
    email: string,
    name: string,
    res: Response,
    meta: { ip?: string | null; userAgent?: string | null },
  ) {
    const existingIdentity = await this.prisma.oidcIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      include: { user: true },
    });

    let user = existingIdentity?.user;
    if (!user) {
      user =
        (await this.prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        })) || undefined;
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            email: email.toLowerCase(),
            name,
            passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
            emailVerifiedAt: new Date(),
          },
        });
      }
      await this.prisma.oidcIdentity.create({
        data: {
          userId: user.id,
          provider,
          subject,
          email: email.toLowerCase(),
        },
      });
    }

    await this.audit.log({
      actorUserId: user.id,
      action: 'auth.oidc_login',
      resourceType: 'user',
      resourceId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { provider },
    });

    return this.auth.loginWithUser(user, res, meta);
  }
}
