import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { RequestUser } from '../common/types/api-response.types';

type Role = RequestUser['role'];
type Status = 'active' | 'suspended' | 'deleted';

export interface ManagedUser {
  id: string;
  role: Role;
}

/** What an admin action does to the target account. */
export interface ManageChange {
  role?: Role;
  status?: Status;
  /** True for `DELETE /admin/users/:id`. */
  delete?: boolean;
}

const isStaff = (role: Role) => role === 'admin' || role === 'super_admin';

/**
 * Whether `change` takes super-admin power away from `target` — the only kind
 * of change that can leave the system with no super_admin at all.
 */
export function revokesSuperAdmin(
  target: ManagedUser,
  change: ManageChange,
): boolean {
  if (target.role !== 'super_admin') return false;
  return (
    change.delete === true ||
    (change.role !== undefined && change.role !== 'super_admin') ||
    (change.status !== undefined && change.status !== 'active')
  );
}

/**
 * The account-management rules every admin user mutation goes through.
 *
 * The role guard only answers "may this caller use the admin API at all";
 * this answers "may this caller do THIS to THAT account". Without it a plain
 * admin could reset a super_admin's password and sign in as them, demote one
 * to `user` (the role-assignment check only looked at the role being granted),
 * or soft-delete one.
 *
 * `activeSuperAdmins` is required only when `revokesSuperAdmin` is true; the
 * caller reads it under a row lock so two super_admins demoting each other at
 * the same time cannot both succeed.
 */
export function assertCanManageUser(
  requester: RequestUser,
  target: ManagedUser,
  change: ManageChange,
  activeSuperAdmins?: number,
): void {
  if (change.status === 'deleted') {
    // A status-only "deleted" skips deletedAt and leaves the phone rows and
    // unique identifiers held — the DELETE route is the one correct path.
    throw new BadRequestException('USE_DELETE_ENDPOINT');
  }

  if (isStaff(target.role) && requester.role !== 'super_admin') {
    throw new ForbiddenException('ONLY_SUPER_ADMIN_CAN_MANAGE_ADMINS');
  }

  if (
    change.role !== undefined &&
    change.role !== 'user' &&
    requester.role !== 'super_admin'
  ) {
    throw new ForbiddenException('ONLY_SUPER_ADMIN_CAN_ASSIGN_ADMIN_ROLES');
  }

  if (requester.id === target.id) {
    if (change.delete) throw new ForbiddenException('CANNOT_DELETE_SELF');
    if (change.role !== undefined && change.role !== target.role) {
      throw new ForbiddenException('CANNOT_CHANGE_OWN_ROLE');
    }
    if (change.status !== undefined && change.status !== 'active') {
      throw new ForbiddenException('CANNOT_SUSPEND_SELF');
    }
  }

  if (revokesSuperAdmin(target, change)) {
    if (activeSuperAdmins === undefined) {
      throw new Error('activeSuperAdmins is required for this change');
    }
    if (activeSuperAdmins <= 1) {
      throw new ConflictException('LAST_SUPER_ADMIN');
    }
  }
}
