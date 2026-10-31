import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { assertCanManageUser, revokesSuperAdmin } from './admin-user-policy';
import type { RequestUser } from '../common/types/api-response.types';

const admin: RequestUser = { id: 'a1', role: 'admin' };
const superAdmin: RequestUser = { id: 's1', role: 'super_admin' };
const plainUser = { id: 'u1', role: 'user' as const };
const otherAdmin = { id: 'a2', role: 'admin' as const };
const otherSuper = { id: 's2', role: 'super_admin' as const };

describe('assertCanManageUser', () => {
  it('lets an admin edit and delete plain users', () => {
    expect(() =>
      assertCanManageUser(admin, plainUser, { status: 'suspended' }),
    ).not.toThrow();
    expect(() =>
      assertCanManageUser(admin, plainUser, { delete: true }),
    ).not.toThrow();
  });

  it.each([
    ['password reset', {}],
    ['demotion to user', { role: 'user' as const }],
    ['suspension', { status: 'suspended' as const }],
    ['deletion', { delete: true }],
  ])('refuses an admin touching a super_admin (%s)', (_label, change) => {
    expect(() => assertCanManageUser(admin, otherSuper, change, 2)).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an admin touching another admin', () => {
    expect(() => assertCanManageUser(admin, otherAdmin, {})).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an admin granting a staff role', () => {
    expect(() =>
      assertCanManageUser(admin, plainUser, { role: 'admin' }),
    ).toThrow(ForbiddenException);
  });

  it('lets a super_admin manage admins and other super_admins', () => {
    expect(() =>
      assertCanManageUser(superAdmin, otherAdmin, { role: 'user' }),
    ).not.toThrow();
    expect(() =>
      assertCanManageUser(superAdmin, otherSuper, { delete: true }, 2),
    ).not.toThrow();
  });

  it('refuses self-deletion, self-demotion and self-suspension', () => {
    const self = { id: superAdmin.id, role: superAdmin.role };
    expect(() =>
      assertCanManageUser(superAdmin, self, { delete: true }, 5),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanManageUser(superAdmin, self, { role: 'admin' }, 5),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanManageUser(superAdmin, self, { status: 'suspended' }, 5),
    ).toThrow(ForbiddenException);
  });

  it('allows a self-edit that keeps role and status', () => {
    const self = { id: admin.id, role: 'user' as const };
    expect(() =>
      assertCanManageUser({ id: admin.id, role: 'user' }, self, {
        role: 'user',
        status: 'active',
      }),
    ).not.toThrow();
  });

  it('refuses to remove the last active super_admin', () => {
    expect(() =>
      assertCanManageUser(superAdmin, otherSuper, { role: 'admin' }, 1),
    ).toThrow(ConflictException);
  });

  it('rejects status "deleted" in favour of the DELETE route', () => {
    expect(() =>
      assertCanManageUser(superAdmin, plainUser, { status: 'deleted' }),
    ).toThrow(BadRequestException);
  });
});

describe('revokesSuperAdmin', () => {
  it('is false for non-super_admin targets', () => {
    expect(revokesSuperAdmin(otherAdmin, { delete: true })).toBe(false);
  });

  it('is false for changes that keep super_admin power', () => {
    expect(
      revokesSuperAdmin(otherSuper, { role: 'super_admin', status: 'active' }),
    ).toBe(false);
  });

  it.each([
    [{ delete: true }],
    [{ role: 'admin' as const }],
    [{ status: 'suspended' as const }],
  ])('is true for %p', (change) => {
    expect(revokesSuperAdmin(otherSuper, change)).toBe(true);
  });
});
