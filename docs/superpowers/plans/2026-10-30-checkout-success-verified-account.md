# Checkout success UX + Verified Account badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the paid-checkout end state explicit and escapable (a clear success screen with a back-to-profile action, live through late confirmations), and give every account with an active paid subscription a "Verified Account" badge on the public profile, ad cards, ad detail seller card and its own `/me` header — like the khmer24 reference the captain sent.

**Architecture:** Verification is **derived, never stored**: a user qualifies when they hold at least one active paid `user_subscriptions` row (`superseded_at IS NULL AND expires_at > now()`). The existing partial index `user_subscriptions_active_idx (user_id, expires_at) WHERE superseded_at IS NULL` serves every check. Three read paths gain an additive boolean — the public profile, the listings feed/detail/trending rows, and the self endpoints (`/auth/me`, `/users/me`) — and the web renders the same badge from it. The checkout page keeps its existing payment API; only its state machine and polling cadence change. No migration, no backfill, no new dependency.

**Tech Stack:** NestJS 11, Drizzle ORM/PostgreSQL, Jest 30; Next.js 16 App Router, next-intl, Tailwind/shadcn-style components.

**Captain's decisions (2026-10-30):**

- Any active **paid** plan grants the badge; the free plan never does. Admin comp grants count (they are real `user_subscriptions` rows).
- Surfaces: public profile header, listing cards, listing detail seller card, own `/me` header.
- Badge lives **while the plan is active**; expiry/revocation removes it automatically.
- The $0.20 payment did activate later, so the confirmation chain works — the failure was the checkout screen (no explicit success, no back button, and it stopped reading before the late confirmation landed).

## Design

### Verified Account

- **Derived at read time.** One helper answers "does this user hold an active paid subscription?" and one SQL expression exposes the same predicate as an `EXISTS` subquery for row queries. Nothing writes a flag, so an expired or revoked plan loses the badge on the next read with no sweep to miss.
- **`manual_comp` rows count.** An admin-granted subscription is indistinguishable from a purchased one at this layer; the badge reflects entitlement, not payment history. Recorded here as a deliberate call.
- **Old `isVerified` is untouched.** Today it means phone/email confirmation (`phoneVerifiedAt || emailVerifiedAt`) and drives the small meta-row chip on profiles. The paid badge is a new, separate `verifiedAccount` field — the two never share a value.
- **Placement.** The public profile header loses its currently unconditional blue rosette and shows a purple check by the name only for a verified account (the old rosette renders for everyone today, which is a bug). Cards get the reference's white pill with purple text and check, top-centre over the photo (discounts stay top-left, the kebab top-right). The detail seller card and `/me` header get the pill/check beside the name.
- **Purple, not brand blue.** The reference uses a purple verification mark; the app's `#00a0e9` accent stays reserved for links/CTAs. One shared `VerifiedAccountBadge` component owns the colour so a future change is one place.

### Checkout end state

| Payment state                      | Screen                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending` / `processing`           | QR + "Waiting for payment" (unchanged)                                                                                                                  |
| `succeeded`, not yet active        | **New success card:** "Payment successful" + "We're activating your {package} plan — this page updates by itself." + Back to profile + My subscriptions |
| `succeeded` and activated          | "You're all set" + Back to profile (new) + View my subscriptions                                                                                        |
| `failed` / `cancelled` / `expired` | Failure card + Try again + Back to profile (new secondary)                                                                                              |

- **Keep reading through late confirmations.** The page currently stops reading 60 s after the QR expires, and with a connected socket it does not poll at all; a confirmation that arrived after that window left the screen frozen. Replace the stop-window with a slow 15 s refresh for as long as the result is outstanding (30-minute cap), keeping the socket push as the fast path.
- Success is shown as soon as the payment itself succeeds; plan activation is a secondary status that upgrades the card in place. A page that has already taken the money must never be a dead end.

## Global Constraints

- No new dependencies in any package.
- **Do not commit.** The captain owns commits; every task ends with verification.
- The working tree carries unrelated uncommitted work (subscriptions/rebrand). Never revert, stash, or reformat unrelated files; touch only the files named in each task.
- No schema change and no migration — verification is derived.
- Feed additions are additive optional fields; existing API consumers must keep working unchanged.
- Keep `pnpm --filter backend build`, `pnpm --filter web build` and both lint gates green after every task.
- i18n: every new user-facing string lands in **both** `apps/web/messages/en.json` and `km.json`.

## Review Focus

- An account whose only subscription is **expired** or **superseded** must render no badge anywhere. (Task 1/2 tests)
- A free-plan account (no `user_subscriptions` row) must render no badge.
- The public profile must not leak anything else new — the response gains exactly one boolean.
- The feed adds one `EXISTS` per row; the plan must not introduce an N+1 or a second query per listing.
- The checkout success card must be reachable **after** the QR expiry, not only inside the old grace window. (Task 5 browser check)

---

### Task 1: Backend — verified-account helper + public/self profile fields

**Files:**

- Create: `apps/backend/src/subscriptions/verified-account.util.ts`
- Modify: `apps/backend/src/users/users.service.ts` (`getPublicProfile`, `findById`)
- Modify: `apps/backend/src/auth/auth.service.ts` (`findById` return shape)
- Test: `apps/backend/src/users/users.service.spec.ts` if present, else the existing auth/users specs that cover these readers

**Interfaces:**

- Produces:
  - `hasActivePaidSubscription(db: DbClient, userId: string): Promise<boolean>`
  - `activePaidSubscriptionExistsSql(userId: SQLWrapper): SQL<boolean>` — an `EXISTS (SELECT 1 FROM user_subscriptions …)` usable inside a row select
  - `PublicProfile.verifiedAccount: boolean`
  - `GET /users/me` and `GET /auth/me` responses gain `verifiedAccount: boolean` (additive; `PublicUser` itself is untouched so no call path changes)

- [ ] **Step 1: Write the helper**

```ts
// apps/backend/src/subscriptions/verified-account.util.ts
import { and, eq, gt, isNull, sql, type SQLWrapper } from "drizzle-orm";
import type { DbClient } from "../db/drizzle.provider";
import { userSubscriptions } from "../db/schema/subscriptions.schema";

/** True while the user holds at least one current, unexpired paid plan. */
export async function hasActivePaidSubscription(
  db: DbClient,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: userSubscriptions.id })
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.userId, userId),
        isNull(userSubscriptions.supersededAt),
        gt(userSubscriptions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The same predicate as a correlated subquery, for row selects. */
export function activePaidSubscriptionExistsSql(
  userId: SQLWrapper,
): ReturnType<typeof sql<boolean>> {
  return sql<boolean>`exists (
    select 1 from user_subscriptions us
    where us.user_id = ${userId}
      and us.superseded_at is null
      and us.expires_at > now()
  )`;
}
```

- [ ] **Step 2: Public profile**

`UsersService.getPublicProfile` gains `verifiedAccount: await hasActivePaidSubscription(this.db, user.id)` in its returned object, and `PublicProfile` gains `verifiedAccount: boolean`. It stays a single extra indexed read, never a per-row loop.

- [ ] **Step 3: Self endpoints**

`UsersService.findById` and `AuthService.findById` return `PublicUser & { verifiedAccount: boolean }` by awaiting the helper once. Leave their private `toPublicUser` unchanged and leave `PublicUser` unchanged, so every other caller keeps its current shape.

- [ ] **Step 4: Tests**

Add cases: active row → `true`; expired row → `false`; superseded row → `false`; no rows → `false`. Mock the select chain the way the existing users/auth specs do.

- [ ] **Step 5: Verify**

Run: `pnpm --filter backend build`, `pnpm --filter backend test -- --testPathPatterns=users` (adjust to the spec names), `pnpm --filter backend lint`.

---

### Task 2: Backend — seller flag on the feed, detail and trending

**Files:**

- Modify: `apps/backend/src/listings/listings.service.ts` (`ListingWithPhotos`, `findById`, `findFeed`, `findTrending`'s two selects)
- Test: `apps/backend/src/listings/listings.service.spec.ts`

**Interfaces:**

- `ListingWithPhotos.sellerVerifiedAccount?: boolean` — present on `findById`, `findFeed` and `findTrending` rows; absent everywhere else, like `sellerUsername`.

- [ ] **Step 1: Add the field**

In the four selects that already carry `sellerUsername: users.username`, add:

```ts
sellerVerifiedAccount: activePaidSubscriptionExistsSql(listings.userId),
```

In `findById`, return `sellerVerifiedAccount: row.sellerVerifiedAccount ?? false` next to `sellerUsername`.

- [ ] **Step 2: Update the specs**

The existing feed/detail/trending mocks return row objects; add the new key where the expected object is compared. Add one assertion for a verified seller and one for an unverified seller.

- [ ] **Step 3: Verify**

Run: `pnpm --filter backend test -- --testPathPatterns=listings`, `pnpm --filter backend build`, `pnpm --filter backend lint`.

---

### Task 3: Web — types, mappers and i18n

**Files:**

- Modify: `apps/web/lib/posts.ts` (`Post.sellerVerifiedAccount?: boolean`)
- Modify: `apps/web/lib/api/categories.ts` (`BackendListing`, `toCardPost`, `buildRealDetailData`)
- Modify: `apps/web/lib/user.ts` (`User.verifiedAccount?: boolean`)
- Modify: `apps/web/lib/api/users.ts` (`BackendPublicProfile`, `toProfileUser`)
- Modify: `apps/web/lib/auth/current-user.ts` (`SessionUser.verifiedAccount?: boolean`)
- Modify: `apps/web/lib/api/adapters.ts` (`BackendUser.verifiedAccount?: boolean`)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/km.json`
- Test: none (type gate)

**Interfaces:**

- `Common.verifiedAccount`: en "Verified Account", km "គណនីបានផ្ទៀងផ្ទាត់".

- [ ] **Step 1: Carry the field through every mapper**

`toCardPost` ← `listing.sellerVerifiedAccount`; `buildRealDetailData` sets the seller's `verifiedAccount` from the same field; `toProfileUser` (public) ← `p.verifiedAccount`; `getCurrentUser` ← `data.verifiedAccount`; `/me` layout's local `toProfileUser` ← `me.verifiedAccount`; `ProfileUser` gains `verifiedAccount?: boolean`.

- [ ] **Step 2: Add the message keys** to both locale files under `Common`.

- [ ] **Step 3: Verify** with `pnpm --filter web build` (the type gate) once Tasks 4–5 land.

---

### Task 4: Web — the badge on all four surfaces

**Files:**

- Create: `apps/web/components/common/VerifiedAccountBadge.tsx`
- Modify: `apps/web/components/ads/GridCardPost.tsx`
- Modify: `apps/web/components/ads/ListCardPost.tsx`
- Modify: `apps/web/components/post/Profile-Sidebar.tsx`
- Modify: `apps/web/components/profile/PublicProfileHeader.tsx`
- Modify: `apps/web/components/profile/MyProfileHeader.tsx`

**Component:**

- `VerifiedAccountBadge({ size?: 'sm' | 'md', className?: string })` — white pill, purple `#7C3AED` text and `BadgeCheck` icon, `rounded-full`, tiny type; used on cards and the seller card.
- `VerifiedAccountCheck` (same file) — the bare purple check for the two headers, where the name row already carries a rosette.

- [ ] **Step 1: Cards**

`GridCardPost`: render the pill absolutely at `top-2 left-1/2 -translate-x-1/2 z-30` over the photo when `post.sellerVerifiedAccount`; it must not capture the card link's clicks (`pointer-events-none`). `ListCardPost`: render it beside the title/seller line, not over the image.

- [ ] **Step 2: Detail seller card**

In `Profile-Sidebar`'s identity block, render the pill beside `user.name` only when `user.verifiedAccount`.

- [ ] **Step 3: Public profile header**

Replace the unconditional `<IconRosetteDiscountCheckFilled …>` after the name with the purple check rendered only when `user.verifiedAccount`. Leave the existing meta-row `user.verified` chip (phone/email) exactly as it is.

- [ ] **Step 4: `/me` header**

`MyProfileHeader` renders the purple check beside the name when `user.verifiedAccount`.

- [ ] **Step 5: Verify** by eye at both `/en` and `/km`: the km pill must not overflow a 260 px card (Khmer strings run ~1.5–2× longer); use `min-w-*`/`whitespace-nowrap` deliberately.

---

### Task 5: Web — checkout success card, back-to-profile and late-confirmation polling

**Files:**

- Modify: `apps/web/app/[locale]/(user)/(subscriptions)/checkout/page.tsx`

- [ ] **Step 1: Success card before activation**

Replace the current spinner card (`payment.status === "succeeded"` branch) with a success card: emerald `BadgeCheck`, h3 "Payment successful", body "Your payment was received. We're activating your {package} plan — this page updates by itself.", primary button **Back to profile** (`Link href="/me"`), secondary **My subscriptions** (`/me/subscriptions`).

- [ ] **Step 2: Activated card**

Keep "You're all set" and its copy; add **Back to profile** as the primary action and keep **View my subscriptions** as the secondary.

- [ ] **Step 3: Failure card**

Add **Back to profile** as a secondary action beside **Try again**.

- [ ] **Step 4: Polling**

- Delete the `EXPIRY_GRACE_MS` stop-window effect and the `!isConnected`-only fallback.
- While `awaitingResult`, refresh the payment every 15 s regardless of socket state, with a 30-minute deadline measured from the first read; at the deadline set the existing "still waiting" message and stop.
- Keep the immediate refresh on connect, on `payment.succeeded` push, and on `visibilitychange`.

- [ ] **Step 5: Verify** with `pnpm --filter web lint`, `pnpm --filter web build`, then a real $0.20 checkout in the browser: the success card appears with both buttons, and leaving/reloading `/me` shows the badge and the active plan.

---

### Task 6: Verification and documentation

- [ ] **Backend:** `pnpm --filter backend build`, `pnpm --filter backend lint`, full `pnpm --filter backend test`.
- [ ] **Web:** `pnpm --filter web build` (type gate) and `pnpm --filter web lint`.
- [ ] **Browser walk** on the dev stack: a paid account shows the check on `/me`, the public profile, a card and the detail seller card; an unpaid account shows none in all four places; the checkout success screen has both buttons.
- [ ] Append the ship entry to `tasks/todo.md` and fold the outcome into `CHANGELOG.md` under `Unreleased`.

## Open questions / risks

- **Two "verified" meanings coexist.** The meta-row chip still means phone/email confirmation; the badge means paid. If this confuses the captain, rename the phone/email chip to "Phone verified" in a follow-up.
- **Feed cost.** One indexed `EXISTS` per row on top of the existing joins. Expected negligible at the current page sizes; if profiling ever shows it, denormalise onto `users` and maintain it from activation/expiry.
- **Comp grants verify.** An admin comped subscription shows the badge. That follows from "any active paid plan"; revisit if verification is meant to be strictly purchased.
- **No backfill needed** because the flag is derived — every existing paid subscriber is verified the moment this ships.
- **Real-payment verification** still depends on Bakong's confirmation latency; the new 15 s read is what keeps the checkout screen honest through it.
