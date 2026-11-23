import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types/auth-user.type';

type AccessPayload = {
  sub: string;
  email: string;
  typ: 'access';
};

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Invalid access token',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: 'active' },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'User not found or disabled',
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }
}
