# Admin & Super Admin Backoffice Audit

**Date:** 2026-10-24 (Asia/Phnom_Penh)  
**Repository:** psa-npic, branch feat/subs, code at HEAD fd824a0 plus unrelated in-flight chat edits  
**Scope:** the attached admin/super-admin use-case diagram vs the implemented admin API (apps/backend/src/admin, auth, payment, subscriptions, reports) and the /wanderer dashboard (apps/web); compared with Khmer24-style classifieds and Shopify-style backoffice governance.  
**Method:** four parallel read-only audits (backend identity/RBAC; operational admin surface; web dashboard; industry comparison), then Lead verification of every critical/high claim against source. No files, migrations, or servers were changed. Targeted Jest suites for the identity policy and reports (3 suites, 32 tests) pass.

---

## Bottom line

1. **The role boundary is real, not cosmetic.** Every admin controller carries RolesGuard plus @Roles, the JWT strategy re-reads role/status from the database on every request, a plain admin cannot create or touch staff accounts, self-demotion/self-deletion through the admin API is blocked, and the last active super admin is protected by a row-locked count. There is no privilege-escalation hole comparable to the one closed in 46e5ed0.
2. **But admin and super_admin are operationally almost identical.** There are zero @Roles('super_admin') routes. The only true differences are the user-management policy (staff targets and staff-role grants are super-admin-only) and the Team page being hidden/redirected in the web UI. The diagram's "Manage Teams & Role" branch is therefore mostly presentational; its "Manage Advertisement Ads" branch does not exist at all.
3. **The dominant risk is not escalation; it is unaudited, over-broad privileged action.** Any admin can forge a payment status, grant or revoke paid subscriptions, edit or hard-delete subscription pricing, delete report evidence, reset a normal user's password, and take listings down - none of it writes an audit record. There is no MFA, no session revocation, and no second pair of eyes for money or identity actions.
4. **One conditional critical must be checked today:** the DEV_OTP_TOKEN SMS bypass is not environment-gated, and apps/backend/.env.prod contains the same fixed token as development. If Vercel's production environment carries that variable, anyone can create accounts for arbitrary phone numbers and take over passwordless phone-linked accounts. The repo cannot prove the deployed value because deploy.yml pulls Vercel project envs; treat it as must-verify, must-fix.
5. **Three business-integrity bugs are confirmed:** payment status can be changed without ledger or status history; deleting a subscription category silently downgrades every paying subscriber to the free plan; and approving a user report suspends the account while all of that seller's listings stay live in the public feed.

---

## 1. Diagram vs implementation

The diagram's connector lines cross heavily, so ownership was read at branch level and the repository's own super-admin spec (docs/super-admin-spec.md) was used as the authoritative intended boundary: admin = routine operations and moderation; super_admin = all admin work plus team/role governance and platform advertisements.

| Diagram use case                                                | Implemented?     | Who can call it                                      | Evidence / note                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login (password/OTP/social)                                     | Yes              | public                                               | POST /auth/login, /auth/otp/_, /auth/social/_. Staff use the same endpoint as users. No MFA.                                                                                                                                                                       |
| Browse / search / view listing, view other profile              | Yes              | public / any auth                                    | Public feed and public profile endpoints. Not admin-specific.                                                                                                                                                                                                      |
| Manage Catalog (brands, models)                                 | Yes              | admin + super_admin                                  | admin-brands/-models controllers and pages.                                                                                                                                                                                                                        |
| Manage Categories                                               | Yes              | admin + super_admin                                  | admin-categories/-subcategories controllers and pages.                                                                                                                                                                                                             |
| Manage Attribute                                                | Yes              | admin + super_admin                                  | attributes controller; generic :type, years writes rejected server-side.                                                                                                                                                                                           |
| Manage User                                                     | Partial          | admin + super_admin (staff actions super_admin only) | Backend CRUD, soft delete, hardened policy. UI lists only role=user and offers only delete; no suspend/activate; staff accounts are not listed anywhere.                                                                                                           |
| Manage Subscription                                             | Partial          | admin + super_admin                                  | Full config CRUD, free plan, user-subscription list, manual grant/revoke. No purchase/refund view; config deletes are hard and unsupervised.                                                                                                                       |
| Manage Payment                                                  | Inadequate       | admin + super_admin                                  | Only PATCH /payments/:id status (refunds refused). No admin list, detail, ledger, or refund workflow.                                                                                                                                                              |
| Manage Listing                                                  | Yes              | admin + super_admin                                  | List any status, take down with reason, restore. No audit and restore erases the moderation record.                                                                                                                                                                |
| Manage Reports (Review User, Review Listings, Approve/Rejected) | Yes              | admin + super_admin                                  | Report reasons CRUD, user/listing report queues, approve/reject. Approving suspends/takes down transactionally. Evidence is hard-deletable.                                                                                                                        |
| View Dashboard & Stats (stats cards)                            | Yes              | admin + super_admin                                  | Four KPI cards plus 7/30/90-day user/listing series. No revenue, subscription, report, or moderation metrics.                                                                                                                                                      |
| Manage Teams & Role                                             | Partial / broken | super_admin (UI + policy)                            | Team page is server-gated to super_admin but queries only role=super_admin, so plain admin accounts are invisible; the Users page excludes staff. Newly created admins disappear from the UI. No team model beyond the role enum, no audit, no session revocation. |
| Manage Advertisement Ads                                        | Missing          | n/a                                                  | No table, endpoint, page, or navigation. Plan Phase 4 is unimplemented.                                                                                                                                                                                            |
| Audit log / workspace settings (in the spec, not the diagram)   | Missing          | n/a                                                  | No audit table/service/UI; no settings model.                                                                                                                                                                                                                      |

**Assessment:** the diagram is a reasonable target for routine operations, but as implemented it overstates governance: super_admin has no exclusive operational surface, and the two capabilities that would justify the role (team/role governance and ads) are respectively incomplete and absent.

---

## 2. What each role can actually do

### Admin (plain)

Can: view dashboard/stats; list/search users and read a user's full profile; create normal users; edit normal users (including resetting their password); soft-delete normal users; full CRUD on categories, subcategories, brands, models, attributes; list and moderate all listings (remove/restore with reason); manage report reasons and user/listing reports, including approving a report (which suspends the target or removes the listing); read and edit subscription config (categories, plans, packages, terms, free plan); list user subscriptions; grant and revoke subscriptions; patch payment transaction status; list and delete feedback; see staff PII through the admin user list; call the chat-metrics endpoint.

Cannot: create or edit admin/super_admin accounts, assign staff roles, change a staff member's status or password, delete staff, demote or suspend themselves, or remove the last active super_admin. Cannot open the Team page in the dashboard (server redirect), but can still call GET /admin/users?role=super_admin and read every super admin's email/phone.

### Super admin

Can: everything an admin can, plus create admin/super_admin accounts, change staff roles/status/passwords, delete staff (subject to self and last-super-admin guards), and use the Team page (though it only lists super admins).

Cannot: revoke another user's sessions; obtain an audit trail; manage advertisements; see purchase/refund state; force a re-login; act with a second approver.

### Enforcement reality

| Control                       | Status                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-controller RBAC           | Solid: @Roles('admin','super_admin') + @UseGuards(RolesGuard) on all admin controllers, attributes, feedback, and payment PATCH; no @Public leak. Guard order is correct (global JWT first). |
| Role source of truth          | Solid: JwtStrategy re-reads role/status/deletedAt per request, so demotion/suspension/deletion take effect on the next REST call. Refresh re-issues from the DB row, never the old claim.    |
| Staff-target policy           | Solid: plain admin cannot manage staff; staff role grants require super_admin; self-demote/self-suspend/self-delete blocked; last active super_admin row-locked and counted transactionally. |
| Super-admin-only API boundary | Absent: zero @Roles('super_admin') routes. Team governance exists only as business policy inside shared admin endpoints, plus a web-page redirect.                                           |
| Audit                         | Absent.                                                                                                                                                                                      |
| MFA / step-up                 | Absent.                                                                                                                                                                                      |
| Session revocation            | Absent.                                                                                                                                                                                      |

---

## 3. Findings

Severity: Critical = exploitable or irreversible business/financial harm; High = serious security, integrity, or governance failure; Medium = meaningful risk or operational breakage; Low = hygiene.

### Critical

#### C1. Dev OTP bypass is not environment-gated, and the production env file contains it

Evidence: apps/backend/src/common/supabase/supabase.service.ts:45-58 activates the bypass whenever DEV_OTP_TOKEN is present: signInWithOtp returns success without sending SMS, and verifyOtp accepts the fixed token for any phone. config.validation.ts:35 accepts the variable in every NODE_ENV. apps/backend/.env.prod contains DEV_OTP_TOKEN (length 6, identical to apps/backend/.env). The app loads .env/.env.local; deploy.yml pulls Vercel project envs, so the live value must be checked in Vercel.

Scenario: an attacker posts /auth/otp/request then /auth/otp/verify with the fixed token. For a phone with no local row, a new account is created (bypassing SMS ownership). For a legacy/bare account with no passwordHash (for example a social-login user who later added a phone), the completion path writes the attacker's password and revives the account. Existing password accounts still require the password.

Impact: unauthenticated account creation at will (spam, scam, evasion), and takeover of passwordless phone-linked accounts. If the production env carries the variable, this is a platform-level authentication bypass.

Fix: reject DEV_OTP_TOKEN when NODE_ENV is production (zod superRefine), delete it from .env.prod, verify Vercel, rotate the token if it was ever live, and add a startup warning/test that fails if the bypass is configured outside development.

#### C2. Payment status can be forged without ledger, status history, or actor

Evidence: payment.controller.ts:127-149 calls upsertPayment directly; upsert-payment.use-case.ts:36-91 only updates status/description/version. It does not post a ledger transaction, does not insert payment_status_history (the table exists and expects actorType admin/actorId), and does not emit an outbox event. Ledger entries only come from provider-event and attempt settlement. Every status except refund_pending/refunded is accepted.

Scenario: an admin with a payment id flips pending to succeeded, or succeeded to failed/cancelled. The transaction row says paid; the ledger has no entries; no subscription activates; no actor is recorded. Conversely a paid record can be made to look failed while money moved.

Impact: financial records can diverge from the ledger with no forensic trace. This is the strongest argument for finance separation and audit.

Fix: remove the route until a proper admin money workflow exists; otherwise route it through a use-case that writes actorType=admin + actorId + reason and posts a reversing/adjusting ledger entry, gated to super_admin or a named finance permission, with no free status choice.

#### C3. Deleting a subscription category silently downgrades every paying subscriber

Evidence: subscription-config.service.ts:194-205 hard-deletes the category with no reference check. user_subscriptions.subscription_category_id and term_id are ON DELETE SET NULL (subscriptions.schema.ts:169-177), and plans/packages/terms cascade. entitlements.service.ts:177-184 filters isNotNull(subscriptionCategoryId), so affected rows vanish from heldGroups. remove\* does not enqueue reconcileListings, unlike updateCategoryScope/updateFreePlan.

Scenario: an admin deletes "General" (or a plan/package under it) while subscribers are live. Their subscription row survives with a null group; entitlements fall back to the free plan on the next reconcile/sweep, restricting ads and photo allowances. No warning, no record, no refund path.

Impact: paying customers lose benefits from a routine-looking delete. Same class of risk for plan/package/term deletes (less severe because offer snapshots preserve limits, but purchase links and display break).

Fix: refuse deletion when live subscriptions or purchases reference the row (409 with counts); retire via isActive instead; if deletion must exist, require super_admin, audit before/after, and reconcile every affected user in the same job.

### High

#### H1. No audit trail for privileged actions

No audit table/service exists. Schema has only payment_status_history. Role changes, suspensions, password resets, subscription grants/revokes, price edits, config deletes, payment patches, listing take-downs/restores, report approvals/deletions, and feedback deletes leave no actor, reason, or before/after record. The spec's Phase 3 and acceptance criteria E are unimplemented.

Impact: disputes cannot be investigated, rogue staff cannot be held accountable, and C2/C3 become invisible. This is the single highest-leverage fix.

Fix: append-only admin_audit_events (actor, action, target type/id, request id, outcome, reason, before/after JSON, created_at), written in the same transaction as each mutation; no update/delete path; super-admin read API/UI with filters and pagination.

#### H2. Staff authentication is password-only, with weak policy and a shared login budget

Evidence: auth.controller.ts:29-35 is the only staff login; no TOTP/WebAuthn anywhere (grep = 0). CreateUserDto/UpdateUserDto allow 6-character passwords (login also accepts 6). Admin login is performed server-side by actions/admin-login.ts, so every web login egresses from the Next server IP; the backend throttle is 10/min keyed by IP with no trust proxy configured, meaning one shared bucket for the platform. The login action returns "not authorized for the admin dashboard" only after the password verified, which is a credential-validity oracle at the most sensitive entry point.

Impact: one stolen password grants full operational control; brute force against the shared bucket can lock staff out; there is no phishing-resistant factor.

Fix: TOTP for all admin/super_admin (recovery codes, enforced after password; small dependency is justified), reject <12-character staff passwords, per-client throttling with forwarded-IP trust or rate limiting inside the Next action, one uniform error message, and lockout/alerting on repeated failures.

#### H3. Sessions cannot be revoked; refresh tokens are stateless

Evidence: issueTokens signs {sub, role} with 15m/30d defaults (refresh 7d locally); refresh re-reads the DB row but has no rotation, reuse detection, jti, denylist, or tokenVersion. Logout only deletes the browser cookie; there is no server logout route. Admin password reset (admin.service.ts:372-373) does not invalidate sessions.

Scenario: staff laptop is stolen or a contractor leaves. After password reset and even demotion, the attacker's refresh token keeps minting access tokens for 7-30 days; only suspension/deletion stops it, and nobody may notice.

Impact: password reset is not an incident-response control.

Fix: users.token_version (or staff_sessions table) bumped on password/role/status/delete and checked in JwtStrategy and refresh; rotate refresh tokens with reuse detection; shorten staff refresh TTL; add an admin session list and "sign out everywhere".

#### H4. Moderation evidence is destroyed

Evidence: reports.service.ts:88-97 and 194-203 hard-delete report reasons and user reports; 293-302 hard-deletes listing reports. Restoring a moderated listing nulls moderatedAt, moderatedById, and moderationReason (listings.service.ts:923-931). Re-removing overwrites the previous actor/reason. Report status updates store only reviewedById and no decision reason.

Impact: a mistaken restore erases who removed a scam ad and why; deleting an approved report erases the basis for a suspension; deleting a reason silently detaches it from historical reports (ON DELETE SET NULL).

Fix: soft-delete reports; make reasons immutable (isActive only); append moderation_events; keep the prior take-down record on restore; require a decision reason on approve/reject; restrict deletion to super_admin and audit it.

#### H5. Suspended or deleted sellers' listings stay live, and there is no un-suspend UI

Evidence: public visibility is listings.status=active and not expired only (listings.service.ts:475-480, 867-871); the query does not join users. Report approval suspends the user row (reports.service.ts:167-189), and admin delete soft-deletes the user (admin.service.ts:415-435), but neither touches listings. The Users page offers delete only; the Team page shows presence, not account status; UpdateUserDto supports status but no UI sends it.

Impact: a seller banned for fraud keeps every active ad in the feed and on detail pages; a mistaken suspension cannot be reversed from the dashboard. This directly undermines the moderation use cases in the diagram.

Fix: hide/reconcile a user's live listings on suspend/delete (and restore on reactivation), add explicit suspend/activate controls with reason and confirmation, show real users.status, notify the user with a reason and appeal path, and require a second reviewer for fraud suspensions.

#### H6. Plain admin accounts are invisible and unmanageable in the dashboard

Evidence: Users page calls getAdminUsers() which pins role=user and pageSize=100 (apps/web/actions/admin-users.ts:19-31; users/page.tsx:5); the client then filters out staff. Team page queries role=super_admin only (team/page.tsx:13; TeamClient.tsx:587-591) and hides role=user. No page queries role=admin. Both pages paginate/search client-side over the fetched page (UserClient.tsx:99-125; TeamClient.tsx:604-631).

Impact: a super_admin can create an admin (default role in the Add User dialog) and then cannot see, edit, suspend, or delete it; the Users page cannot find anyone beyond the newest 100; reports/moderation lists likewise fetch everything and paginate client-side. At Khmer24 scale this is an operational failure, not a cosmetic issue.

Fix: server-side pagination/filtering for users, reports, and subscriptions; a staff tab that actually queries role=admin and role=super_admin; show real account status and expose suspend/activate.

#### H7. Editing a staff member silently deletes their secondary phone rows

Evidence: the adapter maps networks to [primaryPhone] only (lib/api/adapters.ts:59); the Team edit form seeds phones from that (TeamClient.tsx:310-313); the action always sends phones (actions/user.ts:112-119); the backend deletes all user_phones and re-inserts the submitted list (admin.service.ts:387-397). Accounts created without email/phone cannot satisfy the edit schema at all.

Impact: fixing a typo in a name can wipe phone 2 and 3; a staff account can become permanently uneditable; empty submissions leave users.primaryPhone pointing at a deleted row.

Fix: return phones[] in the admin list payload; send phones only when edited; make email optional in the edit schema; preserve primaryPhone consistency in one transaction.

#### H8. Money powers are not segregated and refund obligations are invisible

Evidence: subscription config, manual grants, revokes, and payment PATCH are all @Roles('admin','super_admin'); manual grants create a paid purchase at 0 USD with no actor; revoke leaves the purchase paid with no refund path; activation sets refundRequestedAt when a paid upgrade's base lapsed, but nothing reads it and no admin surface lists it; the settled-payment outbox handler logs "needs manual review" and then still notifies the customer "Payment successful" (payment/outbox/payment-settled-outbox-handler.ts:52-77).

Impact: any admin can comp or revoke revenue-bearing subscriptions, change prices, and mutate payment states; refunds owed to customers are invisible; customers are told a payment succeeded when activation actually failed. Combined with C2/C3 this is the finance-control gap a platform of this size cannot carry.

Fix: a named finance permission (or super_admin gate) for grants/revokes/price/payment changes; four-eyes approval for comps/refunds above a threshold; a needs-refund queue; suppress the success notification when activation needs review; record actor and reason on every money action.

#### H9. Any authenticated user can read anyone's full user row

Evidence: GET /users/:id has only the global JWT guard (users.controller.ts:245-249), calls findById (users.service.ts:99-107), and toPublicUser strips only passwordHash (users.service.ts:1048-1052). It returns primaryPhone, email, role, status, address, latitude/longitude, and deletedAt, with no deletedAt filter.

Impact: any new account can harvest phone numbers, emails, home coordinates, and staff identities by iterating UUIDs from listings/chats/followers. This is a privacy incident and a targeting aid for scams. It also makes C1/H10 account takeover easier by revealing which users are staff.

Fix: serve the PublicProfile allow-list (as /users/by-username does) or make the route self-only; mask phone/email for non-owners; add deletedAt filtering.

#### H10. Development and "production" env files share identical JWT secrets and OTP token

Evidence: .env and .env.prod are both untracked, but their DEV_OTP_TOKEN, JWT_SECRET, and JWT_REFRESH_SECRET compare equal (verified by value without printing). If production was seeded from .env.prod, anyone with repo/dev access can mint a production bearer for a known admin UUID (role is read from the DB, so only sub is needed).

Impact: conditional full admin impersonation; combine with H9 to find admin ids.

Fix: distinct secrets per environment; rotate production secrets; stop keeping a prod-like env file in the developer workspace; verify Vercel values.

### Medium

- M1. Social login links accounts by unverified email with no provider binding (auth.service.ts:267-281, 490-500); no client uses social auth today, so latent, but it is an admin-takeover path once enabled. Require email_confirmed_at and match on provider account id.
- M2. Last-super-admin protection is bypassable through DELETE /users/me (users.service.ts:483-509), which has no policy check. Recoverable by signing in within 90 days, but it breaks the invariant; block self-delete when active super admins <= 1.
- M3. Admin mutations accept deleted/suspended targets (authorizeManage checks existence only, admin.service.ts:452-458); PATCH on a soft-deleted user returns 200 and can set status=active while deletedAt remains, producing a stuck account. Reject non-active/deleted targets with stable codes.
- M4. Zero super-admin-only routes. Team governance is policy plus a web redirect; any admin can still list staff PII. Add @Roles('super_admin') to governance reads and strip staff contact fields for plain admins.
- M5. Unbounded lists: GET /admin/reports/users and /listings return every report; user subscriptions return every current/history row; the web fetches all and paginates client-side. Add server pagination and caps; add users(created_at) and report indexes.
- M6. No CSP, frame-ancestors, HSTS, or no-store on /wanderer; CORS falls back to origin:true with credentials when FRONTEND_ORIGINS is empty (it is empty in both repo env files). Add headers(), fail closed in production, and a noindex.
- M7. Catalog deletes surface FK RESTRICT as 500 and leave orphaned model images (categories/subcategories reference listings; brand delete cascades models but cleans only the brand icon). Pre-check counts and return 409; clean dependent storage.
- M8. Retired plans remain purchasable: checkout checks term/package isActive but not plan/category isActive (subscriptions.service.ts:263-278). Add the missing predicates.
- M9. No step-up or per-route limit on destructive admin calls; only the global 100/min user-keyed throttle. Add confirmation of target identity, per-route throttles, and re-auth for delete/publish/refund.
- M10. Admin password reset is a silent impersonation primitive: a plain admin can reset any normal user's password and sign in as them, with no notification or audit. Legitimate support need, but it needs an audited "reset link"/support action, not a free password field.
- M11. Bootstrap/ops hygiene: admin.seed upserts role super_admin with a fresh password from env, so running db:seed against production promotes/resets that username; Swagger is public at /api/docs; the idempotency middleware can cache login token responses if a client sends Idempotency-Key.
- M12. Validation/index gaps: several UUID params lack ParseUUIDPipe (500 on malformed ids), DTO string lengths exceed varchar constraints (500), stats scans users by created_at without an index, and listUsers.q is not escaped for wildcards.
- M13. Admin React Query cache survives logout (Providers sits in the wanderer layout; no SessionCacheGuard), so a shared workstation can show the previous admin's cached PII for up to 30 s. Clear the cache on logout.
- M14. Login availability/oracle: server-side admin login shares one backend IP throttle bucket across all staff, and the role-mismatch message reveals a correct password. Uniform errors and per-client limits are needed.

### Low

- L1. The WebSocket gateway re-checks deletedAt but not status, so a suspended user's open chat socket keeps working (chat.gateway.ts:123-131 vs jwt.strategy.ts:48).
- L2. Report Users "View Profile" builds a profile URL from display name + UUID, but profiles resolve by username, so the moderator link 404s.
- L3. window.open on report/feedback attachments lacks noopener.
- L4. Admin cookies are unprefixed (admin_access_token), 30-day maxAge despite 15-minute tokens, and a sibling subdomain could shadow them; use \_\_Host- prefixes in the subdomain topology.
- L5. session reads are fail-soft: a backend 5xx bounces a signed-in admin to login.
- L6. Dead SupabaseStrategy registered with a placeholder secret; delete it. Public Swagger exposes the full admin route inventory.
- L7. Status column shows last-seen presence ("Online/Offline"), not account status; a suspended admin reads "Offline".

### Verified safe (so these are not reported as bugs)

- Every admin controller is guarded; no @Public leak; the guard is per-controller, not global, and every controller was checked.
- JWT role/status is DB-derived on every request; demotion, suspension, and deletion take effect on the next REST call; refresh re-issues from the DB row.
- Plain admin cannot create/grant staff roles, cannot target staff accounts, cannot self-demote/suspend/delete, and cannot drive the super-admin count to zero (row-locked count; the mutual-demote race aborts rather than losing both).
- passwordHash is never serialized; admin list page size is capped at 100.
- Report approval/take-down runs in one transaction with FOR UPDATE and settles other pending reports; duplicate/self reports are constrained; report images are ownership-checked.
- No token appears in client bundles/localStorage/RSC; the only dangerouslySetInnerHTML is static chart CSS; CSRF is covered by Next 16 Origin/Host checks plus SameSite=Lax, with no route handlers and no state-changing GETs.
- Admin login only writes cookies after the role check; staff upload scopes are enforced server-side; files deletion is ownership-checked.
- Entitlements read frozen offer snapshots, so later package edits do not change what was bought.

---

## 4. Comparison

| Capability            | This repo                                                                  | Khmer24-style classifieds                                                                                           | Shopify-style backoffice                                     |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Role model            | 3 fixed roles; super_admin inherits admin; no super-only routes            | Publicly buyer/seller; staff/moderation roles undocumented (inferred separate desk)                                 | Owner + staff + org roles, cumulative; custom roles on Plus  |
| Granular permissions  | None by design (plan Phase 6 deferred)                                     | Not public                                                                                                          | Large permission catalogue with dependencies                 |
| MFA                   | None                                                                       | Passkey/QR login offered to users publicly                                                                          | Staff self-enrol 2FA; Plus can require; Payments requires it |
| Session revocation    | None (30-day stateless refresh)                                            | Passkeys revocable per device (public)                                                                              | Suspend users and revoke device permissions                  |
| Audit log             | None for admin actions; only payment_status_history                        | Not public                                                                                                          | Activity log (view-only, 250 rows) + per-object timelines    |
| Moderation evidence   | Take-down stores actor/reason but restore nulls it; reports hard-deletable | Posting rules with penalties (duplicate deletion, blacklist, law-enforcement referral); support hotline for appeals | n/a                                                          |
| Paid packages         | 4-tier config editable/deletable by any admin, no versioning               | Membership area behind login; tiers/pricing not public                                                              | n/a                                                          |
| Finance separation    | Refunds refused; any admin patches payment state                           | Not public                                                                                                          | Permissions for payouts/disputes; 2FA mandatory for Payments |
| Support impersonation | None (but admins can reset normal users' passwords silently)               | Published support hotlines                                                                                          | Scoped app tokens, not impersonation                         |
| PII exposure          | Full row minus passwordHash to any admin; GET /users/:id to any auth user  | Public privacy policy                                                                                               | Permissions gate customer data                               |

What to copy:

- Shopify's append-only activity-log concept, staff 2FA, device/session revocation, and explicit ownership/role-change safeguards.
- Khmer24's published enforcement/appeal path: a suspension should tell the user why and how to appeal, and moderation evidence should be durable.
- Marketplace trust-and-safety practice: separate moderation from finance, require evidence retention, and hide reported/suspended sellers' content.

What not to copy:

- Shopify's ~100-permission matrix or a full IAM/SSO service at this team size; it contradicts the repo's modular-monolith and "no speculative abstraction" rules. Start with two or three named permissions (finance, moderation, catalog) behind the existing policy seam.
- Shopify's 250-row, view-only activity-log limit; build an exportable, filterable audit trail instead.
- OLX-scale ML moderation; at current volume a manual queue plus user reports is sufficient.
- A self-serve appeal portal before volume justifies it; a support mailbox/hotline is cheaper.

---

## 5. Recommendations

Ordered by risk reduction per unit of work. All fit the existing modular monolith and PostgreSQL; no Kafka, microservices, CQRS, or external IAM.

### Phase 0 - verify and stop the bleeding (this week)

1. Check Vercel production env for DEV_OTP_TOKEN, JWT_SECRET, JWT_REFRESH_SECRET, FRONTEND_ORIGINS, NODE_ENV. Remove the OTP bypass; rotate JWT secrets so dev != prod; delete .env.prod from the workspace or replace it with a documented template. Add a zod rule that forbids DEV_OTP_TOKEN outside development.
2. Add admin_audit_events (migration + Drizzle schema + service) and write it transactionally for: role/status/password changes, subscription grant/revoke, subscription config mutations, payment status changes, listing moderate/restore, report decisions/deletes, feedback delete. Include actor, action, target, request id, reason, before/after, outcome. Expose a super-admin read API with cursor pagination and filters.
3. Add users.token_version (or a staff_sessions table), check it in JwtStrategy and refresh, and bump it on password/role/status/delete. Rotate refresh tokens and detect reuse. Add a real logout/revoke endpoint and an admin session list. Shorten staff refresh TTL to days, not a month.
4. Freeze the payment route: remove PATCH /payments/:id or gate it to super_admin behind a use-case that writes an actor row and a ledger adjustment. Add a needs-refund queue; do not send "Payment successful" when activation is needs_refund.
5. Guard subscription config deletes: return 409 when live subscriptions/purchases reference the category/plan/package/term; retire via isActive; audit and reconcile affected users.

### Phase 1 - make the backoffice trustworthy (2-4 weeks)

6. Add TOTP MFA for admin/super_admin, enforced at login, with recovery codes and re-auth for high-risk actions. Use one justified dependency (or Supabase MFA if staff identities are moved there); do not build a bespoke IAM.
7. Fix the Team/Users surfaces: server-side pagination; a staff tab that queries role=admin and role=super_admin; real account status; suspend/activate with reason; show the target's current and proposed state before a role change. Fix the phone edit data loss and make optional fields optional.
8. Make suspension effective: hide/reconcile a suspended or deleted user's listings, notify the user with a reason and appeal contact, and require a second reviewer for fraud suspensions. Add moderation_events and stop nulling the take-down record on restore; soft-delete reports and make reasons immutable.
9. Super-admin-only API routes for team governance and finance config, matching the spec's @Roles('super_admin'); keep ordinary admin reads on shared routes and strip staff contact fields for plain admins.
10. Security headers and network hygiene: frame-ancestors 'none', a modest CSP, HSTS, no-store for /wanderer, noindex; fail CORS closed when the allowlist is empty; per-client login throttling with forwarded-IP trust; uniform login errors; per-route limits on destructive admin calls.
11. PII minimization: GET /users/:id becomes self-only or returns the public allow-list; admin list returns an explicit allow-list with masked phone/email behind a reveal action that is audited.

### Phase 2 - close the product gaps (1-3 months)

12. Advertisement ads as a separate platform-owned domain (schema, lifecycle, super-admin-only endpoints, audit, dashboard page), exactly as the plan/spec Phase 4 describes. Do this before any paid-placement launch.
13. Finance workflow: refunds (if the business wants them) with four-eyes approval, ledger reversal, and an auditable trail; named finance permission if staff grow beyond a handful.
14. Audit UI: super-admin filtering/pagination/export, with links from user, listing, subscription, and payment detail pages.
15. Moderation queue ergonomics: pagination, SLA/aging, duplicate grouping, decision reasons, and an appeal record. Add the missing report decision reason field.
16. Operational dashboards: revenue/subscription/payment/report metrics, not just user/listing counters; add indexes used by stats.

### Phase 3 - only when evidence demands it

17. Named permission scopes (support, moderation, catalog, finance) behind the existing policy helper, and approver workflows. Do not build a general policy engine or microservice until the team and workflows actually require it.
18. Workspace settings with typed keys, draft/publish/rollback, secret masking, and re-auth (plan Phase 5). This is correctly deferred; it is a configuration database risk if rushed.

### Trade-offs and evolution

- Audit logging costs one extra insert per privileged mutation and a small migration; it is the cheapest insurance in the list and unlocks every other control.
- MFA and re-auth add friction for staff; budget a recovery-code process and a break-glass super admin, or staff will share passwords.
- Token versioning logs everyone out on role/password change; that is the point, but communicate it and make refresh seamless.
- Blocking category deletes may frustrate admins; offer "deactivate" and show dependent counts instead of raw errors.
- Super-admin-only finance routes reduce admin autonomy; if the team grows, replace the blanket rule with a named finance permission rather than widening admin again.
- Hiding suspended sellers' listings is a product decision with legal/retention implications; implement it as a flag and document the policy.

---

## 6. Risks of the recommended path

- A rushed audit log written outside the mutation transaction produces misleading history; write it in the same transaction and fail the mutation if the audit insert fails.
- MFA without recovery planning can lock out the only super admin; pair it with break-glass codes and a tested recovery runbook.
- Token revocation can create login storms if implemented without rotation and a grace window; roll out to staff first.
- Super-only finance routes could block legitimate operations during a launch; document the escalation path and keep a break-glass super admin.
- Soft-deleting instead of hard-deleting report/config rows changes query assumptions; audit every read path and retention job.
- Hiding listings on suspension can break legitimate appeals; keep the rows and make restoration explicit.

---

## 7. What to verify next

1. Vercel production env values: DEV_OTP_TOKEN present? JWT_SECRET/JWT_REFRESH_SECRET equal to .env.prod? FRONTEND_ORIGINS empty? NODE_ENV set? (Highest priority; decides whether C1/H10 are live or conditional.)
2. Production database counts: number of admin and super_admin rows; staff accounts with >1 phone; live subscriptions per category; payment statuses and refundRequestedAt rows.
3. Whether any social-auth client exists in production (H2/M1 exploitability); Supabase email-confirmation setting.
4. Deployment topology: admin subdomain or path-based? That decides cookie prefixing, CSRF surface, and header placement.
5. Business decisions: refunds in scope? ads/sponsorship in scope? should suspended sellers' content disappear? who may reset passwords? how many super admins?
6. After fixes: run backend tests, web build/lint, and a browser matrix for admin vs super_admin (Team redirect, role change, suspend/activate, payment/refund, report approve/restore, audit view), plus a concurrency test for last-super-admin removal against a real database.

---

## Appendix A - endpoint / role matrix (admin-relevant)

| Route                                                                 | Allowed                                 |
| --------------------------------------------------------------------- | --------------------------------------- |
| auth/login, register, otp/_, social/_, telegram, refresh              | public, IP-throttled                    |
| auth/me; users/me\*; files user scopes                                | any authenticated                       |
| users/by-username/:username                                           | public allow-list                       |
| users/:id                                                             | any authenticated (over-exposed; H9)    |
| admin/users GET (including ?role=super_admin)                         | admin or super_admin                    |
| admin/users POST role=user; PATCH/DELETE normal users                 | admin or super_admin                    |
| admin/users POST staff role; PATCH/DELETE staff                       | super_admin (service policy, not route) |
| admin/stats, stats/timeseries, chat-metrics                           | admin or super_admin                    |
| admin/categories, subcategories, brands, models, attributes, feedback | admin or super_admin                    |
| admin/listings, listings/:id/remove, listings/:id/restore             | admin or super_admin                    |
| admin/reports/\* (reasons, users, listings)                           | admin or super_admin                    |
| admin/subscriptions/_, admin/user-subscriptions/_                     | admin or super_admin                    |
| payments PATCH :id                                                    | admin or super_admin                    |
| /wanderer/dashboard/team                                              | super_admin (web page only)             |
| files staff scopes                                                    | admin or super_admin (handler check)    |

## Appendix B - sources (external research)

- Shopify staff permissions: https://help.shopify.com/en/manual/your-account/staff-accounts/staff-permissions/staff-permissions-descriptions
- Shopify two-step authentication: https://help.shopify.com/en/manual/your-account/logging-in/two-step-authentication
- Shopify activity logs: https://help.shopify.com/en/manual/shopify-admin/activity-logs
- Shopify user management / device revocation: https://help.shopify.com/en/manual/your-account/users/manage-users
- Shopify ownership transfer: https://help.shopify.com/en/manual/your-account/manage-orgs-and-stores/change-transfer-ownership
- Khmer24 posting rules: https://www.khmer24.com/en/posting-rule
- Khmer24 contact/support: https://www.khmer24.com/en/contact-us
- Khmer24 membership area (auth-gated): https://www.khmer24.com/en/me/membership
- Khmer24 privacy policy: https://www.khmer24.com/en/privacy-policy
- Etsy removal/appeals: https://help.etsy.com/hc/en-us/articles/360061329494-Why-Was-My-Listing-Removed-by-Etsy
- eBay removed/hidden listings: https://www.ebay.com/help/selling/listings/creating-managing-listings/removed-hidden-listings?id=4656
- OLX trust and safety: https://www.olxgroup.com/trust/

## Appendix C - open questions

1. Is the production env actually derived from .env.prod or from Vercel project settings? (C1/H10)
2. Is there a reverse proxy/WAF adding security headers or setting trust proxy in production? (M6/M14)
3. Should admins be allowed to reset normal users' passwords, or should support issue an audited reset link? (M10)
4. Is content removal on suspension expected product behavior, or should ads remain visible? (H5)
5. Are advertisement ads internal promotions or paid campaigns, and is billing required? (Phase 2)
6. What is the retention policy for reports, moderation evidence, and audit events? (H4/Phase 1)
7. How many staff will exist in the next 12 months? This decides whether named permissions are worth building now or later.

---

_No product code or database schema was modified for this audit. This report is the only file written._
