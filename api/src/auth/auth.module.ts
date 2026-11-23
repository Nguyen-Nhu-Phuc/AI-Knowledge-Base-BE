import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt-access' }), JwtModule.register({})],
  controllers: [AuthController, ScimController],
  providers: [AuthService, OidcService, ScimService, JwtAccessStrategy],
  exports: [AuthService, OidcService, ScimService],
})
export class AuthModule {}
