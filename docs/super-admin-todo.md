# Super Admin Implementation Tasks

**Status:** In progress. Phase 1 mostly shipped 2026-10-23 in `46e5ed0`. Phases 3–6 not started (verified against code 2026-10-24; see also `admin-backoffice-audit-2026-10-24.md`).  
**Source:** [`super-admin-plan.md`](./super-admin-plan.md) and [`super-admin-spec.md`](./super-admin-spec.md)

## Phase 0 — Decisions

- [ ] Decide the minimum number of active break-glass super admins.
- [ ] Decide whether role changes invalidate access tokens immediately. _De facto yes: `JwtStrategy.validate` re-reads role/status/deletedAt on every request and refresh re-issues from the DB row. Not yet recorded as a decision._
- [ ] Decide whether advertisement ads are internal promotions or paid campaigns.
- [ ] Select the first advertisement placements and lifecycle states.
- [ ] Select high-impact actions that require re-authentication.
- [ ] Select the initial audit action allowlist.

## Phase 1 — Authorization hardening

- [x] Add an application-level admin identity policy helper. (`admin/admin-user-policy.ts`, `46e5ed0`)
- [x] Pass the authenticated actor into every role/status/delete mutation. (`AdminService.authorizeManage`: update, delete, user-report approval)
- [x] Block self-demotion. (`CANNOT_CHANGE_OWN_ROLE`)
- [x] Block self-delete from admin control. (`CANNOT_DELETE_SELF`; self-suspend also blocked)
- [x] Block demotion, suspension, and deletion of the last active super admin. (`LAST_SUPER_ADMIN`, counted under `FOR UPDATE`)
- [ ] Make deleted/suspended targets return explicit errors. _Partial: a missing row is 404, but a soft-deleted target is still accepted._
- [ ] Add stable error codes and DTO/API documentation. _Partial: stable codes exist as exception messages; not documented in Swagger._
- [ ] Add backend unit and service tests for all rules. _Partial: `admin-user-policy.spec.ts` (10 cases) and the report-approval path; no `AdminService` spec for the locked count._

## Phase 2 — Team management

- [ ] Keep the Team page super-admin-only at route and API levels. _Partial: the route redirects (`f008db6`, 2026-08-15) and staff mutations are policy-checked, but `GET /admin/users?role=super_admin` is readable by any admin._
- [x] Hide or disable role-management controls for regular admins. (Team link hidden in `app-sidebar.tsx`; the Users page offers no role control)
- [ ] Add target identity/current state to role mutation confirmation.
- [ ] Add explicit confirmation copy for demotion, suspension, and deletion.
- [ ] Refresh the Team table after successful mutations.
- [ ] Verify the user list does not expose a misleading super-admin option to regular admins.

## Phase 3 — Audit log

- [ ] Add PostgreSQL migration for append-only admin audit events.
- [ ] Add Drizzle schema and indexes for actor, target, action, and timestamp.
- [ ] Add an audit service with typed action names.
- [ ] Write audit events in the same transaction as privileged mutations.
- [ ] Add `GET /admin/audit` with offset/cursor pagination and filters.
- [ ] Add the super-admin Audit Log page.
- [ ] Ensure audit events cannot be edited/deleted through the application.

## Phase 4 — Advertisement ads

- [ ] Define advertisement placements and lifecycle states.
- [ ] Add advertisement ads schema/migration separate from `listings`.
- [ ] Add typed DTOs for draft, update, publish, pause, schedule, and archive.
- [ ] Add super-admin-only advertisement-ad endpoints.
- [ ] Add preview and schedule validation.
- [ ] Add Advertisement Ads dashboard page.
- [ ] Add audit events for advertisement lifecycle changes.
- [ ] Add public read/render integration only after the placement contract is approved.

## Phase 5 — Workspace settings

- [ ] Define the first setting-key registry and value schemas.
- [ ] Add versioned settings storage and migration.
- [ ] Add draft/propose workflow.
- [ ] Add validation for type, range, dependency, and blast radius.
- [ ] Add before/after review UI.
- [ ] Add publish and rollback endpoints.
- [ ] Add cache invalidation after publish.
- [ ] Add re-authentication for high-impact settings.
- [ ] Mask integration secrets and keep secret values outside PostgreSQL/UI.

## Phase 6 — Session and operational verification

- [ ] Implement the selected role-change session policy.
- [ ] Test old access and refresh tokens after demotion.
- [ ] Test concurrent last-super-admin mutations.
- [ ] Test direct API calls that bypass hidden dashboard controls.
- [ ] Run backend tests, lint, build, and web build/lint.
- [ ] Run a browser matrix for admin and super-admin dashboards.
- [ ] Update architecture documentation and the running ship log.

## Explicitly deferred

- Fine-grained permissions for every admin module.
- Approval workflows involving multiple humans.
- External IAM/SSO.
- Separate authorization service.
- Multi-tenant settings isolation.
