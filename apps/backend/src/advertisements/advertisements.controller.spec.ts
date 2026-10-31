import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  AdminAdvertisementsController,
  AdvertisementsController,
} from './advertisements.controller';

/**
 * Banner management is the backend's first super_admin-only surface, so the
 * rule gets its own test rather than resting on the decorators reading right.
 * RolesGuard reads its metadata off the handler AND the class, so the fake
 * context has to supply both.
 */
function contextFor(
  controller: unknown,
  handlerName: string,
  role?: string,
): ExecutionContext {
  const proto = (controller as { prototype: Record<string, unknown> })
    .prototype;
  return {
    getHandler: () => proto[handlerName],
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { id: 'u-1', role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('advertisement authorization', () => {
  const guard = new RolesGuard(new Reflector());

  it('admits only super_admin to the admin controller', () => {
    const as = (role?: string) =>
      guard.canActivate(
        contextFor(AdminAdvertisementsController, 'list', role),
      );

    expect(as('super_admin')).toBe(true);
    expect(as('admin')).toBe(false);
    expect(as('user')).toBe(false);
    expect(as()).toBe(false);
  });

  it('leaves the storefront read open to anonymous visitors', () => {
    expect(
      guard.canActivate(contextFor(AdvertisementsController, 'list')),
    ).toBe(true);
  });
});
