import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, hashToken } from '../common/utils/token-hash.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthUser } from './types/auth-user.type';

type RequestMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private userPublic(user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    isPlatformAdmin: boolean;
    emailVerifiedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    };
  }

  private async signAccessToken(user: { id: string; email: string }) {
    const expiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
    return this.jwt.signAsync(
      { sub: user.id, email: user.email, typ: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );
  }

  private refreshCookieOptions() {
    const sameSite = this.config.get<string>('REFRESH_COOKIE_SAME_SITE', 'lax') as
      | 'lax'
      | 'strict'
      | 'none';
    return {
      httpOnly: true,
      secure: this.config.get<string>('REFRESH_COOKIE_SECURE', 'false') === 'true',
      sameSite,
      path: `/${this.config.get<string>('API_PREFIX', 'api/v1')}/auth`,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  private setRefreshCookie(res: Response, token: string) {
    const name = this.config.get<string>('REFRESH_COOKIE_NAME', 'akb_refresh_token');
    res.cookie(name, token, this.refreshCookieOptions());
  }

  clearRefreshCookie(res: Response) {
    const name = this.config.get<string>('REFRESH_COOKIE_NAME', 'akb_refresh_token');
    res.clearCookie(name, this.refreshCookieOptions());
  }

  private async issueRefreshToken(
    userId: string,
    meta: RequestMeta,
  ): Promise<string> {
    const token = generateOpaqueToken(48);
    const days = 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    return token;
  }

  private async issueSession(
    user: { id: string; email: string },
    res: Response,
    meta: RequestMeta,
  ) {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id, meta);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  /** Public session issue for OIDC / SCIM-provisioned users */
  async loginWithUser(
    user: {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      isPlatformAdmin: boolean;
      emailVerifiedAt: Date | null;
      createdAt: Date;
      status?: string;
      deletedAt?: Date | null;
    },
    res: Response,
    meta: RequestMeta,
  ) {
    if (user.deletedAt || (user.status && user.status !== 'active')) {
      throw new UnauthorizedException({
        code: 'FORBIDDEN',
        message: 'Account is disabled',
      });
    }
    const session = await this.issueSession(user, res, meta);
    return { user: this.userPublic(user), ...session };
  }

  async register(dto: RegisterDto, res: Response, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && !existing.deletedAt) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Email already registered',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const platformEmails = (this.config.get<string>('PLATFORM_ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash,
        isPlatformAdmin: platformEmails.includes(email),
      },
    });

    await this.audit.log({
      actorUserId: user.id,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const session = await this.issueSession(user, res, meta);
    return { user: this.userPublic(user), ...session };
  }

  async login(dto: LoginDto, res: Response, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid credentials',
      });
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException({
        code: 'FORBIDDEN',
        message: 'Account is disabled',
      });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid credentials',
      });
    }

    await this.audit.log({
      actorUserId: user.id,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const session = await this.issueSession(user, res, meta);
    return { user: this.userPublic(user), ...session };
  }

  async refresh(refreshToken: string | undefined, res: Response, meta: RequestMeta) {
    if (!refreshToken) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Refresh token missing',
      });
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt.getTime() < Date.now() ||
      stored.user.deletedAt ||
      stored.user.status !== 'active'
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid refresh token',
      });
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const session = await this.issueSession(stored.user, res, meta);
    return { user: this.userPublic(stored.user), ...session };
  }

  async logout(refreshToken: string | undefined, res: Response, user?: AuthUser) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    if (user) {
      await this.audit.log({
        actorUserId: user.id,
        action: 'auth.logout',
        resourceType: 'user',
        resourceId: user.id,
      });
    }

    this.clearRefreshCookie(res);
    return { success: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'User not found',
      });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Current password is incorrect',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.log({
      actorUserId: userId,
      action: 'auth.password_change',
      resourceType: 'user',
      resourceId: userId,
    });

    return { success: true };
  }
}
