# Super Admin Governance Plan

**Status:** Proposed  
**Date:** 2026-10-06  
**Scope:** Backend authorization, admin dashboard delegation, workspace settings, auditability

## Decision

Keep `super_admin` as a first-class role that **inherits the complete admin responsibility** and extends it with two additional platform responsibilities:

1. **Team and role management**
2. **Advertisement ads management**

- `user` uses marketplace and account features.
- `admin` performs daily marketplace operations.
- `super_admin` performs all admin operations, manages the admin team and roles, and manages platform advertisement ads.

This is an evolutionary change inside the existing modular monolith. It does not require microservices, CQRS, Kafka, or a general-purpose policy engine.

## Current state

The repository already has the identity primitive:

- `users.role` supports `user`, `admin`, and `super_admin`.
- JWT payloads carry `{ sub, role }`.
- `JwtStrategy` re-checks the current active user.
- `AdminService` prevents a normal admin from assigning admin-level roles.
- The Team page is restricted to `super_admin`.

The boundary is incomplete:

- All admin controllers currently admit both `admin` and `super_admin`.
- The dashboard mostly differs through sidebar visibility.
- The Team page exists, but its role-management boundary needs hardening.
- There is no dedicated advertisement-ads feature or super-admin-only API boundary.
- There is no last-super-admin protection.
- There is no self-demotion/self-delete protection.
- There is no admin audit log.
- Role changes do not have an explicit session invalidation policy.

## Target operating model

### Admin owns operations

Admins may:

- review and moderate users, listings, and reports;
- maintain routine catalog data and attributes;
- operate subscriptions and user subscription workflows when delegated;
- view operational metrics and assigned work;
- propose changes to global settings.

Admins may not:

- grant, revoke, or change an administrative role;
- publish high-impact workspace settings;
- access raw integration secrets;
- remove the final active super admin;
- bypass audit or approval rules.

### Super admin extends admin

Super admins inherit all admin permissions and may additionally:

- create, update, suspend, and demote admin accounts;
- manage the super-admin team subject to break-glass protections;
- create, update, publish, pause, schedule, and archive platform advertisement ads;
- review all privileged audit events;
- execute team and role recovery actions.

Super-admin actions must still be explicit, validated, transactional where consistency matters, and auditable.

## Dashboard delegation

The web application should share components and layout primitives, but expose different responsibilities:

| Area               | Admin                                       | Super admin                                             |
| ------------------ | ------------------------------------------- | ------------------------------------------------------- |
| Dashboard          | Operational KPIs and assigned work          | Same admin dashboard plus super-admin controls          |
| Users              | User support and moderation                 | Same admin operations plus team/admin identity controls |
| Listings/reports   | Routine moderation and resolution           | Same admin operations plus advertisement ads management |
| Catalog/attributes | Routine editing                             | Same admin operations                                   |
| Subscriptions      | Routine subscription operations             | Same admin operations                                   |
| Payments           | Existing admin payment responsibility       | Same admin operations                                   |
| Team and roles     | No access to role governance                | Full administrative identity management                 |
| Advertisement ads  | No access unless explicitly delegated later | Create, edit, publish, pause, schedule, and remove      |
| Audit/security     | Relevant operational history only           | Full privileged history and role/advertisement history  |

The sidebar is presentation only. The NestJS API and application services remain the security boundary.

### Advertisement ads versus user listings

The existing user listing lifecycle (`listings`) belongs to marketplace users and should not be overloaded with platform advertising. Advertisement ads are a separate responsibility and should have their own domain model:

- owner: the platform/workspace, not a marketplace user;
- lifecycle: draft → scheduled → active → paused/expired/archived;
- placement: a defined surface;
- scheduling: start/end time;
- creative: controlled image/link/content references;
- audit: actor and before/after state for every privileged mutation.

The first implementation must confirm whether these are internal platform promotions or paid campaigns. Until then, design a neutral platform-ad lifecycle and do not add billing, impressions, clicks, or budgets.

## Workspace settings

Create a separate workspace-settings capability rather than putting global controls inside unrelated screens.

Initial setting groups:

1. Workspace identity: name, logo, contact information, default locale, time zone.
2. Marketplace policy: listing rules, moderation defaults, retention windows.
3. Security/access: session policy, role policy, break-glass controls.
4. Payments/subscriptions: pricing policy, provider mode, activation state.
5. Integrations: health and configuration references for Supabase, email/SMS, storage, webhooks.
6. Feature rollout: feature flags, maintenance mode, schedules, rollback.
7. Operational limits: upload limits, throttling, retention, queue policies.

Raw secrets must never be stored in or returned by the dashboard. Store secret material in deployment secret storage and expose masked status and controlled test operations only.

## Delivery phases

### Phase 1 — Harden the existing role boundary

- Introduce a small policy helper for admin identity mutations.
- Pass the requesting actor into all sensitive mutations.
- Prevent self-demotion and self-delete from admin control.
- Prevent demotion, suspension, or deletion of the last active super admin.
- Define and test role-change session behavior.

### Phase 2 — Make Team management authoritative

- Keep the Team route and navigation super-admin-only.
- Add explicit confirmation for role/status changes.
- Show impact and target identity before mutation.
- Return stable API error codes for protected operations.
- Refresh/invalidate relevant dashboard queries after success.

### Phase 3 — Add audit logging

- Add an append-only audit table and service.
- Record actor, action, target, request ID, timestamp, outcome, and before/after values.
- Write the audit record in the same transaction as role/status/settings mutations.
- Add super-admin audit views with filtering and pagination.

### Phase 4 — Add advertisement ads management

- Define the advertisement-ad entity and lifecycle separately from user listings.
- Add super-admin-only create/update/publish/pause/archive endpoints.
- Add the Advertisement Ads dashboard page.
- Add scheduling, placement, preview, and validation.
- Add audit events for every lifecycle transition.
- Add read-only operational visibility for admins only if the business needs it.

### Phase 5 — Add workspace settings only if needed

- Add typed settings storage with versioning.
- Add draft/propose, validate, review, publish, and rollback behavior.
- Require re-authentication for high-impact changes.
- Add cache invalidation and operational health feedback.

### Phase 6 — Split permissions only when evidence requires it

- Keep broad operational admin access initially.
- Add named permissions or scoped roles only when the team has distinct operator jobs.
- Avoid a large permission matrix until real workflows prove the need.

## Trade-offs and evolution path

This plan minimizes risk and implementation cost now. The cost is that regular admins remain broad operators during the first phase. That is acceptable while the team is small; audit history and the policy helper create the seam for later scoped permissions without rewriting controllers.

If the organization later needs support, moderation, catalog, finance, or compliance specialists, add named permissions behind the existing policy boundary. Do not replace the role model prematurely.

## Risks

- A stale token may retain authority after a role change unless session invalidation is implemented.
- A missing last-super-admin guard can permanently remove recovery access.
- A UI-only restriction can be bypassed through direct API calls.
- Workspace settings can create a dangerous “configuration database” if types, ranges, ownership, and rollback are not explicit.
- Audit logging outside the mutation transaction can produce misleading history.

## Decisions required before implementation

1. How many active break-glass super admins are required?
2. Should role changes revoke all active sessions immediately?
3. Are advertisement ads internal platform promotions or paid campaigns?
4. Which advertisement placements and lifecycle states are required first?
5. Which actions require re-authentication?
6. Which three privileged actions must be audited on day one?
