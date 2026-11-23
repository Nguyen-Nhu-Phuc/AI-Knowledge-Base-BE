import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from './types/auth-user.type';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

class OidcStubDto {
  @IsIn(['google', 'microsoft'])
  provider!: 'google' | 'microsoft';

  @IsString()
  @MinLength(3)
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidc: OidcService,
    private readonly config: ConfigService,
  ) {}

  private meta(req: Request) {
    return {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  private refreshFrom(req: Request): string | undefined {
    const name = this.config.get<string>('REFRESH_COOKIE_NAME', 'akb_refresh_token');
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[name];
    if (cookieToken) return cookieToken;
    const header = req.header('x-refresh-token');
    return header || undefined;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.register(dto, res, this.meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(dto, res, this.meta(req));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.refresh(this.refreshFrom(req), res, this.meta(req));
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    return this.authService.logout(this.refreshFrom(req), res, user);
  }

  @Public()
  @Get('oidc/:provider/start')
  oidcStart(@Param('provider') provider: 'google' | 'microsoft') {
    return this.oidc.begin(provider);
  }

  @Public()
  @Get('oidc/callback')
  async oidcCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.oidc.callback(code, state, res, this.meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('oidc/stub')
  async oidcStub(
    @Body() dto: OidcStubDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.oidc.stubLogin(
      dto.provider,
      dto.email,
      dto.name || dto.email.split('@')[0],
      res,
      this.meta(req),
    );
  }
}
