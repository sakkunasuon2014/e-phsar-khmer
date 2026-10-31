import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

/**
 * Literal role matching — there is no hierarchy between roles. Since
 * 2026-10-26 `super_admin` is a **governance tier, not a bigger admin tier**:
 * it does not satisfy `@Roles('admin')`. Catalogue, listings, attributes,
 * subscriptions and payments are admin work; stats, reports, team (via
 * `/admin/users`), feedback and advertisements are the super_admin mandate, so
 * those controllers name both roles explicitly.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return requiredRoles.includes(request.user?.role ?? '');
  }
}
