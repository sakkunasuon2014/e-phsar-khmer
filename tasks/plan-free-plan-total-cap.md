# Free plan: total cap with category sub-limits

**Status:** done 2026-10-29 (approved by the captain: "yes go ahead"; tab styling kept as implemented after review).
**Decision:** the free plan is one account-wide cap (5 live ads). Category rows
(car 2, rental 2, motorcycles 2, fashion 50, foods 50) are sub-limits inside
that total; a cap larger than the total never binds. `free_plan_settings.other_ads`
becomes the total — no new column, no API rename. Video/auto-renews stay hidden
and unenforced. A held group keeps its own pool — a Property (1000 ads) plan
does not lift the car cap; the Manage Ads card sums the pools (1005).

**Renewals (captain, 2026-10-29):** the pool's `renews` resets on a rolling
30-day window (`listing_renewals`), not a lifetime counter.

## Why

- Today those numbers are independent pools, so a free user can hold
  2+2+2+50+50+5 = 111 live ads while the Manage Ads card shows a sum that
  changes meaning with the ad mix.
- Renews are enforced per ad but displayed account-wide (2 ads renewed 3x read
  6/5).
- The Active/Expired tab pair reads inverted: the selected tab is white on a
  white card, the unselected one is a solid grey block.

## Steps

- [x] `allowance.ts`: free ads collapse into one `free` pool (`otherAds`);
      scope caps resolved by `scopeCapOf` as sub-limits; partition enforces both.
- [x] `entitlements.service.ts`: overview limits = free total + held group
      totals; usage gains `hidden`; `assertCanHoldAnotherAd` checks pool + scope;
      `assertCanRenew` counts renews across the pool in the rolling 30-day
      window (`listing_renewals`); scope view reports the effective (clamped)
      limit.
- [x] `listings.service.ts`: reconcile after owner delete; restricted ads stay
      renewable once their window lapses; public detail 404s restricted.
- [x] Web: Manage Ads cards use the overview numbers; Hidden tab for
      restricted ads; segmented-control tab design; free sheet renames
      "Other Ads" → "Total Ads"; admin Free Plan relabels the field.
- [x] Tests: `allowance.spec.ts`, `entitlements.service.spec.ts`,
      `listings.service.spec.ts` updated/added.
- [x] Docs: subscriptions README, CLAUDE.md, tasks/todo.md ship entry.

## Verification

`pnpm --filter backend test`, backend lint + build, web lint + `next build`,
`db:generate` no-drift, prettier check.

## Result

- Post flow: the allowance is enforced at create too (403, nothing inserted);
  a refused publish still rolls the created ad back and shows the backend's
  reason on the form — no invisible drafts. The one orphan draft on the dev DB
  was removed.
- Renew window: migration `0046_noisy_wolverine` adds `listing_renewals`
  (one row per renewal, cascading with its listing/user); publish writes it in
  the same transaction as the extension. Live API: `usage.renews` 0 → 1 with
  one logged renewal → 0 after cleanup. Applied on the dev DB (watermark
  checked).
- Backend: `nest build` clean, eslint clean, **75 suites / 1007 tests** pass.
- Web: `eslint` clean, `next build` (type gate) clean; `db:generate` reports no
  schema changes; root `format:check` clean.
- Live API on the dev stack (`:3000`, watch mode): `/subscriptions/entitlements`
  returns `limits.ads 5`, `usage { ads: 5, renews: 0, hidden: 0 }`, one `free`
  bucket; `/subscriptions/free-plan` returns `otherAds 5` with caps 2/2/2/50/50;
  `/listings/me/all?status=restricted` returns 200.
- Browser (production build on `:3004`, dev-DB session): Manage Ads cards read
  **Total Ads 5/5 · Renews 2/5** at the time of the check (the rolling renew
  window landed after it; the API now reports renews 0 for the fresh window),
  Active (5) / Expired (72) tabs equal width
  (618 px) with the segmented track; `/en/me/membership` renders the Free sheet
  as Photos 8 · **Total Ads 5** · Cars 2 · Motorcycles 2 · Rentals 2 ·
  Fashion 50 · Foods 50 · Renews 5.
- `/en/me/membership` on the running `next dev` (`:3001`) first showed the
  loading skeleton with no server-action request (stale dev router); creating
  and deleting a file under `apps/web/app/` forced the rescan and the page then
  rendered the free sheet with its five server-action POSTs. The dev server was
  not restarted.

## Rollout

No migration. The cap takes effect on the next reconcile sweep (~10 min) or an
admin free-plan save (enqueues a sweep). Over-limit ads become `restricted`,
not deleted; raising the cap restores them newest-first.
