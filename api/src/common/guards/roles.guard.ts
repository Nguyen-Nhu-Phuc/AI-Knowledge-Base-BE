import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../../auth/types/auth-user.type';

type RequestWithTenant = {
  user: AuthUser;
  membership?: { role: OrgRole };
};

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const membership = request.membership;

    if (!membership) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Organization membership required',
      });
    }

    const userRank = ROLE_RANK[membership.role];
    const ok = requiredRoles.some((role) => userRank >= ROLE_RANK[role]);

    if (!ok) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
    }

    return true;
  }
}
