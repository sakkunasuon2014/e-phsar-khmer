# Subscriptions Review Fixes

**Status:** Implemented and committed 2026-10-23 in `f074f5e`. Commit isolation verified 2026-10-24: the deploy workflow landed separately in `e54cca3`. Subscription suites pass (8/8, 69 tests). The only open item is "Failed outbox events are invisible" (below).
**Date:** 2026-10-23
**Source:** Standards review of `git diff d465bdf` on `rothh/subscriptions`: the five subscription commits `275e8bb`…`53dfd6e` plus the uncommitted working tree. There was no spec, so only the Standards axis was reviewed.
**Rules cited:** `AGENTS.md` (concurrency, testing, smallest diff), `CLAUDE.md` (web on port 3001, Module README convention), Fowler smell baseline (always a judgement call).

Each item gives the **finding**, the **requirement** (what "fixed" means) and the **acceptance** check. Phases are ordered by risk. Phase 1 should land before this branch merges; Phases 2–4 can follow.

---

## Phase 0 — Decisions (answer before coding)

- [x] **Web port.** Restored `-p 3001` in `apps/web/package.json` `dev`/`start` scripts.
- [x] **`.github/workflows/deploy.yml`.** Kept the pre-existing worktree change untouched and outside subscription edits; no commit was created, so it remains to be committed separately.
- [x] **Migrations `0038` + `0039`.** Kept both unchanged because of applied shared-dev history and the migration watermark trap. Recorded the decision in the 2026-10-23 ship log.
- [x] **One name for "subscription category".** Kept the database table names; user/catalog API and web type fields now use `groupId`/`groupName`/`groupSlug`.

---

## Phase 1 — Hard violations

### 1.1 [x] Guard the restore/restrict UPDATEs in `reconcileListings`

- **Finding:** `apps/backend/src/subscriptions/entitlements.service.ts:573-584` reads the user's live ads, partitions them, then updates them **by id only**:
  ```ts
  .set({ status: 'active', updatedAt: new Date() })
  .where(inArray(listings.id, toRestore));
  ```
  This is a read-modify-write with no concurrency guard (`AGENTS.md`: Postgres is the source of truth, think about concurrency). It now runs for **every** user from `reconcileAllInBackground` (admin scope edit, free plan edit) and from the 10-minute sweep, at the same time as owners editing their ads. If an ad is deleted, expired or soft-removed between the read and the write, it is flipped back to `active`.
- **Requirement:**
  - The restore UPDATE matches only rows still `restricted`: `and(inArray(listings.id, toRestore), eq(listings.status, 'restricted'))`.
  - The restrict UPDATE matches only rows still `active`: `and(inArray(listings.id, toRestrict), eq(listings.status, 'active'))`.
  - Both also filter `eq(listings.userId, userId)`, as defence in depth.
  - The returned counts come from `.returning({ id })` length, not from the pre-read arrays, so callers and logs report what actually changed.
- **Acceptance:** a unit test in `entitlements.service.spec.ts` asserts that both WHERE clauses carry the status predicate, and that a row whose status changed after the read is not counted. The existing reconcile tests still pass.

### 1.2 [x] Tests for the new admin behaviour

- **Finding:** `src/admin/subscriptions/` has no `*.spec.ts`. New or changed behaviour with zero coverage (`AGENTS.md`, Testing):
  - `SubscriptionConfigService.updateCategoryScope`
  - `SubscriptionConfigService.updateFreePlan`
  - `UserSubscriptionsService.revoke`
- **Requirement:** add `subscription-config.service.spec.ts` and `user-subscriptions.service.spec.ts`, using the mocked-DB style of the existing `entitlements.service.spec.ts`.
  - `updateCategoryScope`:
    - success replaces the scope
    - 23505 → `ConflictException` with the "added to another group" message
    - any other error goes through `rethrow`
    - triggers a background reconcile (once 2.1 lands: enqueues a reconcile)
  - `updateFreePlan`:
    - a limit with both or neither of `categoryId`/`subcategoryId` → 400
    - a duplicate scope → 400
    - writes settings and replaces the limits in one transaction
    - a subcategory limit stores `categoryId: null`
    - triggers a reconcile
    - returns `getFreePlan()`
  - `revoke`:
    - a current row → `{ id }` + `reconcileListingsSafely(userId)`
    - an already superseded row → 409
    - an unknown id → 404
- **Acceptance:** `pnpm --filter backend test -- --testPathPatterns=admin/subscriptions` is green, and every listed case is its own `it`.

### 1.3 [x] Keep unrelated changes out of the branch (verified: `f074f5e` holds no deploy change; `e54cca3` holds it)

- **Finding:** see Phase 0 (web port, `deploy.yml`). Both are uncommitted, sit outside the subscriptions scope, and break the smallest-diff rule.
- **Requirement:** apply the Phase 0 decision. The subscriptions commit contains only subscription files.
- **Acceptance:** port 3001 is restored. The deploy workflow remains an untouched independent worktree diff; verify commit separation when creating commits (no commit was created in this session).

---

## Phase 2 — Correctness-adjacent judgement calls

### 2.1 [x] Run admin-triggered reconciles through BullMQ, not a `void` promise

- **Finding:** `EntitlementsService.reconcileAllInBackground` (`entitlements.service.ts:633`) is `void this.reconcileAll().catch(...)`. It runs in the request process after the response is sent: it is lost on restart or deploy, can be cut off on a serverless host, and two quick admin edits run two full sweeps in parallel. The repo already has a queue for exactly this: `ENTITLEMENTS_QUEUE` + `EntitlementsProcessor` (`entitlements-sweep.processor.ts`).
- **Requirement:**
  - Replace the fire-and-forget call with a one-off job on `ENTITLEMENTS_QUEUE`, for example `queue.add(LISTING_SWEEP_JOB, {}, { jobId: 'reconcile-on-config-change', removeOnComplete: true })`. A fixed `jobId` collapses a burst of edits into one pending run.
  - Put the enqueue in one small method (for example on `EntitlementsScheduler`, which already owns the queue) so `EntitlementsService` gains no queue dependency.
  - Enqueue failure is logged and swallowed, because the 10-minute sweep is the backstop. This matches the current contract.
- **Trade-off:** a few seconds of delay before ads re-restrict after an admin edit, and admin edits now depend on Redis being up (the sweep already does).
- **Acceptance:** the two call sites (`subscription-config.service.ts:147`, `:481`) call the enqueue method. A spec asserts the job name and `jobId`. `reconcileAllInBackground` is deleted.

### 2.2 [x] Honest 409 message from `updateFreePlan`

- **Finding:** two concurrent free-plan saves can both delete and re-insert `free_plan_ad_limits` and hit `free_plan_ad_limits_{category,subcategory}_uq` (23505). The `.catch` sends that through `rethrow`, which answers **"Slug already in use"**. The free plan has no slug.
- **Requirement:** catch 23505 in `updateFreePlan`, as `updateCategoryScope` already does, and throw `ConflictException('The free plan was just changed by someone else. Reload and try again.')`.
- **Acceptance:** covered by a case in 1.2's spec.

### 2.3 [x] Type `supersededReason` end to end

- **Finding:** a `SupersededReason` union exists (`subscription-activation.service.ts:107`), but the column is `varchar(40)`. It is typed `string | null` in `subscriptionStatus` (`:119`), `user-subscriptions.service.ts:43`, `apps/web/actions/admin-user-subscriptions.ts:22` and `users-subscription/page.tsx:80`.
- **Requirement:**
  - Move `SupersededReason` and `subscriptionStatus` into a small `apps/backend/src/subscriptions/subscription-status.ts`. Both are imported by two other services, so they don't belong in the activation service.
  - Type the column `varchar('superseded_reason', { length: 40 }).$type<SupersededReason>()`. This is TS-only, so no migration.
  - Use `SupersededReason | null` in the service row types and view types.
- **Acceptance:** `tsc` is clean, and a typo such as `'revokd'` in any `.set({ supersededReason })` fails to compile.

---

## Phase 3 — Duplication and naming (judgement calls)

- [x] **3.1 One free-plan settings mapper.** `SubscriptionConfigService.getFreePlan` (`subscription-config.service.ts:420-434`, `settings ?? DEFAULT_FREE_PLAN`) and `EntitlementsService.loadConfig` (`entitlements.service.ts:112-135`) each turn a `free_plan_settings` row into `FreePlanSettings`. Extract `toFreePlanSettings(row | undefined): FreePlanSettings` next to `DEFAULT_FREE_PLAN` in `entitlements.constants.ts` and use it from both.
- [x] **3.2 Reuse `freeLimits`.** `view()`'s overview branch (`entitlements.service.ts:349-355`) rebuilds `{ photos, ads, renews, autoRenews, videos }` by hand. Export `freeLimits` from `allowance.ts:49` and call `freeLimits(config.free, config.free.otherAds)`.
- [x] **3.3 Remove the placeholder scope.** `entitlements.service.ts:295` calls `bucketOf({ categoryId: '', subcategoryId: anySub[0] }, …)` only to get a group's bucket. Add `groupBucket(groupId, config, held)` to `allowance.ts` (and use it inside `bucketOf`) so no caller invents an `AdScope`. Cover it in `allowance.spec.ts`.
- [x] **3.4 One category-tree hook (web).** `app/wanderer/dashboard/subscription/free-plan/page.tsx:54-71` and `components/dashboard/subscription-scope-dialog.tsx:41-62` both run the `["admin","categories"]` + `["admin","subcategories"]` queries and build the same tree in a `useMemo`. Extract `hooks/use-admin-category-tree.ts` returning `{ tree, isLoading }`. The query keys stay the same, so the shared cache entries still dedupe.
- [x] **3.5 One subscription status type (web).** The union `"active" | "expired" | "superseded" | "revoked"` appears in `actions/subscriptions.ts:46` and `actions/admin-user-subscriptions.ts:23`. Define `SubscriptionStatus` (and `SupersededReason`) once in `apps/web/types/subscription.ts` and import it from both. Keep the types out of the `"use server"` files.
- [x] **3.6 Type the bucket key (web).** `EntitlementBucket.key` (`actions/subscriptions.ts:95`) is `string`. Mirror the backend `BucketKey` template-literal type (`allowance.ts:15`) so a hand-built key that doesn't match is a compile error.
- [x] **3.7 Rename group fields (per the Phase 0 decision).** Web `UserSubscription.categoryId`/`categoryName` and `SubscriptionCatalogItem.categoryId`/`categorySlug`/… hold the _subscription group_, not a listing category. Rename them to `groupId`/`groupName`/`groupSlug` in the response and the web types, as one atomic backend + web change. Widest blast radius in this list: do it last, in its own commit.
- [x] **3.8 One bucket-wording helper (web).** `bucket?.kind === "group" ? … : …` is repeated at `components/post/ListingPostForm.tsx:703,717` and twice inside one string at `actions/listings.ts:563`. Add `describeBucket(bucket)` to `lib/subscription-pricing.ts`, returning `{ planLabel, scopeLabel, ctaLabel }`, and use it from all three sites so the copy can't drift apart.

---

## Phase 4 — Docs

- [x] **4.1 Module README.** `apps/backend/src/admin/subscriptions/README.md` predates groups. Add, following the Module README convention:
  - group scopes (`subscription_category_subcategories`) and their 409 rule
  - the free plan tables
  - one current subscription per (user, group)
  - revoke vs supersede reasons
  - the reconcile path (2.1)

  Carry open items (b) `autoRenews`/`videos` unenforced and (c) the restricted demo listings from the 2026-10-21 ship log.

- [x] **4.2 `CLAUDE.md`.** The Subscriptions section (`user_subscriptions` bullet) still describes one global subscription with derived status. Update it to: group-scoped, `superseded_at`/`superseded_reason`, free plan as admin config, revoke endpoint. This is open item (d) of the 2026-10-21 ship-log entry.
- [x] **4.3 Ship log.** Append a dated `tasks/todo.md` entry when these land, including the Phase 0 decisions.

---

## Carried over from removed docs

`docs/chat-and-outbox.md` and `docs/notifications.md` were deleted on 2026-10-23. Both were point-in-time scout reports of 2026-09-02 branches, and what they described has since merged: `src/outbox/`, the chat WebSocket gateway, `src/notifications/`. They remain in git history. One finding from them is still true and has no other home:

- [ ] **Failed outbox events are invisible.** (Still open, re-checked 2026-10-24: `last_error` is only written in `outbox.service.ts`.) `outbox_events.last_error` is recorded, but nothing reads it: no admin endpoint, metric or alert. `failed` rows are kept as dead letters by `OutboxRetention`, so they pile up unseen. Out of scope for this branch; track separately.

---

## Verification gate (all phases)

```bash
pnpm --filter backend test
pnpm --filter backend lint
pnpm --filter backend build
pnpm --filter web lint
pnpm --filter web build   # type gate for web
```
