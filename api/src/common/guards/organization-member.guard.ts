import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../auth/types/auth-user.type';

type RequestWithOrg = {
  user: AuthUser;
  params: { orgId?: string; organizationId?: string };
  membership?: {
    id: string;
    organizationId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
  };
};

@Injectable()
export class OrganizationMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOrg>();
    const orgId = request.params.orgId ?? request.params.organizationId;

    if (!orgId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Organization id is required',
      });
    }

    const organization = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });

    if (!organization) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: request.user.id,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You are not a member of this organization',
      });
    }

    request.organization = organization;
    request.membership = membership;
    return true;
  }
}
