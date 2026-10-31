# Super Admin Governance Specification

**Status:** Proposed  
**Related plan:** [`super-admin-plan.md`](./super-admin-plan.md)

## 1. Goals

1. Make `super_admin` an explicit extension of `admin`.
2. Protect the organization from privilege escalation and administrative lockout.
3. Add platform advertisement ads without confusing them with user-owned marketplace listings.
4. Make the web dashboard reflect responsibility without relying on the UI for security.
5. Establish an auditable seam for future permissions and workspace settings.
6. Preserve the existing response envelope, JWT shape, modular monolith, and PostgreSQL source of truth.

## 2. Non-goals

- No microservices or separate identity service.
- No general-purpose policy language.
- No full enterprise IAM/SSO implementation.
- No broad permission matrix in the first release.
- No raw secrets stored in workspace settings.
- No replacement of the existing `admin` role for routine operations.

## 3. Role semantics

```text
user         Marketplace and account features.
admin        Routine operations and moderation.
super_admin  All admin responsibilities plus team/role management and advertisement ads.
```

`super_admin` inherits all `admin` permissions. It additionally owns team/role management and platform advertisement ads. It is not automatically allowed to bypass validation, transactions, audit logging, or resource ownership rules.

## 4. Authorization rules

### 4.1 Administrative identity

- Only `super_admin` may assign `admin` or `super_admin`.
- Only `super_admin` may revoke `admin` or `super_admin`.
- An actor may not demote or delete their own administrative account.
- The final active `super_admin` may not be demoted, suspended, or deleted.
- Mutations must check the actor and target inside the same transaction as the write.
- A target that is missing, deleted, or suspended must return a stable error rather than a success-shaped response.

### 4.2 Operational admin

Existing admin areas remain available to both roles unless a later decision narrows them:

- dashboard metrics;
- users and moderation;
- listings and reports;
- categories, subcategories, brands, models, and attributes;
- subscriptions and user subscriptions.

The first release does not split these operational areas into many permissions. The distinction is enforced on high-risk actions, not every read.

### 4.3 Advertisement ads

Advertisement ads are platform-owned promotional content. They are not the same as marketplace user's `listings` and should not be added as a flag on that table.

Initial lifecycle:

```text
draft -> scheduled -> active -> paused -> archived
                         \-> expired
```

Initial conceptual fields:

```text
id
title
description/content
creative_image_url or creative_asset_reference
destination_url
placement
status
starts_at
ends_at
created_by
updated_by
created_at
updated_at
```

Rules:

- only `super_admin` may create, update, publish, pause, schedule, or archive an advertisement ad;
- every transition validates dates, placement, content, and target URL;
- an active ad must have a valid schedule;
- an ad cannot be published without previewable content;
- every mutation creates an audit event;
- regular admins may receive read-only visibility only if operations require it;
- campaign billing and analytics are out of scope until explicitly approved.

### 4.4 Workspace settings

Workspace settings are global, typed, versioned configuration. Each setting has:

```ts
type WorkspaceSetting<T> = {
  key: string;
  value: T;
  version: number;
  status: "draft" | "published" | "scheduled" | "rolled_back";
  updatedBy: string;
  updatedAt: Date;
};
```

The implementation may use a typed JSONB value initially, but every supported key must have a server-side schema and validator. Unknown keys must be rejected.

Required lifecycle:

1. create or propose a draft;
2. validate type, range, dependencies, and impact;
3. show before/after review;
4. require re-authentication for high-impact settings;
5. publish in a transaction;
6. write an audit event;
7. invalidate affected caches;
8. support rollback to the previous published version.

### 4.4 Secrets

The settings API must not return secret values. Integration settings may return:

- configured/unconfigured state;
- masked identifier;
- last rotated timestamp;
- health/test result;
- a controlled rotate or test action.

## 5. Backend design

### 5.1 Policy boundary

Add a small application-level policy helper under the admin feature, for example:

```ts
assertCanManageAdminIdentity(actor, target, action);
assertCanPublishWorkspaceSetting(actor, settingKey);
assertCanDeleteAdmin(actor, target, activeSuperAdminCount);
```

The helper should model business decisions, not HTTP details. Controllers remain thin and pass `RequestUser` into the service.

### 5.2 API surface

The first release should extend existing admin endpoints rather than create a separate service:

```text
PATCH  /api/v1/admin/users/:id
DELETE /api/v1/admin/users/:id
GET    /api/v1/admin/audit
GET    /api/v1/admin/workspace-settings
POST   /api/v1/admin/workspace-settings/:key/drafts
POST   /api/v1/admin/workspace-settings/:key/publish
POST   /api/v1/admin/workspace-settings/:key/rollback
POST   /api/v1/admin/advertisement-ads
PATCH  /api/v1/admin/advertisement-ads/:id
POST   /api/v1/admin/advertisement-ads/:id/publish
POST   /api/v1/admin/advertisement-ads/:id/pause
POST   /api/v1/admin/advertisement-ads/:id/archive
```

Exact route names may change during implementation, but the contract must preserve:

- `@Roles('admin', 'super_admin')` for ordinary admin reads;
- `@Roles('super_admin')` for team/role and advertisement-ad mutations;
- request actor propagation;
- the repository response envelope;
- typed DTO validation;
- explicit error codes for protected operations.

### 5.3 Audit event

Proposed fields:

```text
id
actor_user_id
action
target_type
target_id
request_id
before_json
after_json
outcome
reason
created_at
```

Use an append-only table. Do not update or delete audit events through the dashboard.

### 5.4 Session behavior

The implementation must choose one of these policies before coding:

- **Immediate invalidation:** add a session/token version or revocation record and reject old tokens.
- **Short-lived transition:** keep access tokens short-lived and revoke refresh capability after role change.

The chosen policy must be documented and tested. A role change must not leave a demoted user with indefinite authority.

## 6. Web application behavior

### 6.1 Session and route gate

The current web flow remains valid:

1. dashboard route reads the admin cookie;
2. `getCurrentUser()` resolves the current user;
3. the dashboard layout redirects non-admin users;
4. the API remains the final authorization boundary.

The dashboard must not assume that a valid admin cookie means the user has a specific permission.

### 6.2 Navigation

Admin navigation:

- Dashboard
- Users/moderation
- Listings/reports
- Catalog/attributes
- Subscriptions
- assigned operational work

Super-admin navigation adds:

- Team/admin accounts
- Advertisement Ads
- Audit log for team and advertisement changes

Workspace Settings remains a later capability and should not be presented as a committed first-release feature until its scope is approved.

Shared routes may be reused, but controls must be disabled/hidden consistently with the backend policy.

### 6.3 Mutation UX

For privileged actions:

- show the target identity and current role/status;
- show the proposed new state;
- require explicit confirmation;
- display stable API error messages;
- invalidate the relevant TanStack Query key after success;
- never treat a hidden button as authorization;
- show audit/recovery consequences where applicable.

## 7. Testing specification

### Backend

- unit tests for every policy rule;
- transaction-level tests for last-super-admin protection;
- controller tests for role-specific access;
- tests for stable error codes;
- audit event tests including before/after values;
- workspace setting validation, publish, rollback, and unknown-key rejection;
- session behavior test after role change.

### Web

- regular admin cannot reach Team or Workspace Settings;
- super admin sees governance navigation;
- role/status mutation confirmation renders target and impact;
- 403/error responses produce an actionable toast;
- successful mutation refreshes the table and dashboard state;
- no raw secret is rendered in the UI.

### Advertisement ads

- regular admins cannot create, update, publish, pause, schedule, or archive advertisement ads;
- super admins can create and edit a draft advertisement ad;
- an advertisement ad cannot publish without valid content, placement, and schedule;
- scheduled ads activate only inside their configured window;
- paused, expired, or archived ads do not render on public advertisement surfaces;
- advertisement ads are stored separately from user marketplace listings;
- advertisement lifecycle mutations create audit events.

## 8. Backwards compatibility

- Keep the existing `user_role` enum.
- Keep JWT payload `{ sub, role }`.
- Keep ordinary admin routes working for current admins.
- Do not require a new dependency.
- Existing admin users continue operating unless explicitly changed by a super admin.
- Additive migrations must be safe for an existing PostgreSQL database.
