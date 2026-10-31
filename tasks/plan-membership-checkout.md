# Plan — restore the Membership + Checkout design on real data

Captain's request (2026-10-26): bring back the pre-prod (v1) look for the Membership page and the
Checkout page, but backed by real plans and real fetching. The prod merge (`6811a70`) replaced both
with a ring/3xl design.

## Decisions already taken

- **URLs stay as they are.** The plan screen keeps `/me/subscriptions` (every link — footer, settings,
  checkout back-links, profile "Upgrade Account" — points there). `/me/membership` keeps redirecting
  to it. No routing churn.
- **Data layer is untouched.** `components/profile/Subscription.tsx` already reads
  `getMySubscriptions()` + `getPublicFreePlan()` and derives held plans via `activeSubscriptions()`.
  Only the presentation changes.
- **Checkout logic is untouched.** The 878-line page's state machine (offer unavailable / blocked /
  method picker / QR waiting / succeeded-activating / failed / activated) and every action call
  (`createSubscriptionCheckout`, `getPaymentTransactionStatus`, `getSubscriptionCatalog`,
  `getPaymentProviders`) stay exactly as they are. Only the JSX shell changes.

## Constraint that shapes the Checkout design

**There is no billing-address backend.** No `billing_addresses` table, no route, no action — the
reference screenshot's "Address: Home" card with name / phone / map has no data source. `/me/billing-addresses`
is still a mock component. So the Address card will render the signed-in account's real name and
phone from `getCurrentUser()`, plus the old v1 "no saved addresses" state with an **Add Address**
call to action. It will not pretend to have a saved address or a map.

Same for **Account ID** — there is no such field. The Subscription card shows the account username
and the plan's real term / expiry instead.

## Phase 1 — Membership page (`components/profile/Subscription.tsx`)

Reuse the existing data logic; replace the JSX with the v1 design language:

- `Breadcrumbs`: Home › Profile › Membership (`components/common/Breadcrumbs.tsx`).
- `Membership` heading at `text-2xl font-medium` (not `text-3xl font-semibold`).
- Plan sheets back to `bg-card border rounded-sm`; centred title; `divide-y` label/value rows;
  `px-4 py-4`.
- One sheet per held subscription (title = package, subtitle = group · term), then the Free sheet.
- "Need More?" card + full-width `#00a0e9` "Upgrade Now" button (the old mock's shape).
- Keep the loading skeleton and the error/retry state.

Out of scope for the sheet: the prod History list (past plans). If the captain wants it back, it goes
below the Upgrade button in the same card style.

## Phase 2 — Checkout page (`(subscriptions)/checkout/page.tsx`)

- Replace "‹ Back to plans" + the `Checkout` h1 + the three progress dots with `Breadcrumbs`:
  Home › Profile › Membership › Check Out.
- New **Subscription** card at the top: account avatar, `packageName` / `planName` line,
  account username, term, and the due-today price.
- New **Address** card: real name + `primaryPhone` from `getCurrentUser()`; "Add Address" empty
  state (no address backend — see constraint above).
- **Payment Methods** block: keep the real `providers` list and the unavailable handling, restyled
  to the reference's tile + check rows.
- **Summary**: keep the existing price / credit / due-today maths and the "Continue to payment"
  button, restyled into the reference's summary card.
- Every state branch above must still render — including the QR block and the auto-activation poll.

## Non-goals

- No backend changes, no new dependencies, no new routes.
- No attempt to fake a saved address, a map thumbnail, or an account id.

## Risks

1. **Payment regression** — the highest risk. The state machine must be preserved byte-for-byte in
   behaviour; the diff is presentation only. Verify each branch in the browser.
2. **Design drift** — the reference is Khmer24's flow, not ours; matching it exactly would import a
   few things we have no data for (address, account id). The plan above keeps our substance and
   borrows the layout.
3. **Build gate** — `next build` cannot run in this session (Google Fonts egress is blocked). `lint`
   and `tsc --noEmit` can.

## Verification

- `pnpm --filter web lint`, `pnpm --filter web exec tsc --noEmit`.
- Browser walk with a real dev session: `/me/subscriptions` (free plan + an active plan) and
  `/checkout?id=…` through method picker → QR → activated.
- Confirm `/me/membership` still lands on the plan screen.

## Phase 3 — Premium account pages (added 2026-10-26, after Phases 1–2 shipped)

The captain extended the same rule to `/premium-account` and `/premium-account/[category]`.

- **Index** — v1 chrome (`bg-muted`, shared `Breadcrumbs`, `max-w-4xl`, `border bg-card rounded-sm`
  cards, blue underlined "Subscribe"), but the groups come from the live catalog instead of v1's
  five hardcoded entries, and a held plan shows its package plus "N days left" with the link reading
  "Upgrade".
- **Plan page** — v1 chrome (sky-bordered selected card, `CircleCheck` benefit list, radio term rows
  with accent-sky, orange "Subscribe Now" summary), but plans/packages/terms/prices/discounts are all
  real catalog rows. Every `offerState` branch (new / upgrade / current / unavailable) is preserved.

## Phase 4 — Un-fold the two pages (2026-10-26, captain's correction)

The "URLs stay as they are" decision above is **reversed**. The captain: `/me/subscriptions` must not
render the Membership screen — the Subscriptions tab is its own list page (reference: the v1 mock's
title + Type/Status/Sort bar, populated with the viewer's real subscriptions).

- `/me/subscriptions` → new `components/profile/Subscriptions.tsx`, back **inside** the `(profile)`
  group so the profile tab bar renders above it. Real rows from `getMySubscriptions()`; filters are
  client-side (Type = real subscription groups, Status, Sort). Card = image tile, Service
  (package − term), Account ID (username — there is no account-id field), Service (group), Valid
  Until, Price, status word bottom-right, matching the reference.
- `/me/membership` → the plan screen again (`<Subscription />`, standalone, own breadcrumbs).
- "Upgrade Account" (profile header) and the footer "Membership" link point at `/me/membership`
  again; Settings' "Subscription & Plan" stays on `/me/subscriptions`.

Checklist:

- [x] `tasks/plan-membership-checkout.md` records the reversal
- [x] `components/profile/Subscriptions.tsx`
- [x] `me/(profile)/subscriptions/page.tsx` restored; standalone `me/subscriptions/page.tsx` removed
- [x] `me/membership/page.tsx` renders the plan screen
- [x] header + footer links repointed
- [x] en/km message keys for the card labels and `Me.metadata.membership`
- [x] web lint / type gate / browser walk

**Verified (2026-10-26)** — `pnpm --filter web lint`, `tsc --noEmit`, `prettier --check` and
`next build` all clean; both routes present in the build. Headless Chromium with a real dev session:
`/en/me/subscriptions` renders the profile tab bar (Subscriptions active) + title + Type/Status/Sort
over the empty state ("No Result! / Oops! … / Subscribe Now"); `/en/me/membership` renders the plan
sheets standalone (no tabs, breadcrumbs Home › Profile › Membership); "Upgrade Account" lands on
`/en/me/membership`; the footer's Membership link points there too. The populated card was checked
with a temporary two-row fixture (Expired + Active) and then removed — the fixture dates read
`Service: Bronze - 6 Months / Account ID: … / Service: Cars for sale / Valid Until: 18 Oct 2026 /
Price: $60 / Expired`.
