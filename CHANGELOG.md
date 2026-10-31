# Changelog

All notable changes to this monorepo (`apps/backend`, `apps/web`, `apps/mobile`) are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project has no
version tags yet, so releases are grouped by **ship date** (the commit dates on `main`/feature
branches) instead of version numbers.

How to use this file:

- New work goes under **Unreleased** while it is uncommitted or unmerged; move it under a dated
  heading when it ships.
- The detailed per-ship notes (verification steps, data repairs, open questions) still go in
  `tasks/todo.md`. Once an entry has shipped, fold its outcome into this file and drop it from
  the log. The full historical log up to 2026-10-24 is in git (`git show fd824a0:tasks/todo.md`).
- Migrations are named by their file prefix in `apps/backend/drizzle/migrations/`.
- Plans cited below that were deleted once shipped (`tasks/plan.md`, `tasks/spec.md`,
  `tasks/plan-e2e-phase1-2.md`, `tasks/plan-tenant-subscriptions.md`) can still be read with
  `git show 5783531:<path>`. Design references were moved to `docs/`.

## [Unreleased]

### Added

- **Linked social accounts on `/settings`.** The Facebook / Google / Telegram rows now read
  `Add` or `Linked` from the account's real provider links and carry the `>` chevron.
  `GET /users/me?includeAuthProviders=1` returns the linked providers (additive and opt-in, so
  the `(user)` layout pays no extra query); the settings hub and rail share a new
  `LinkedAccountsRows`. Google/Facebook can be connected with the OAuth popup plus a per-flow
  nonce (`social_link_pending`, echoed in the `/auth/link/{provider}/{nonce}` path), and a
  linked row opens a confirmation dialog calling the new JWT-protected
  `DELETE /auth/social/:provider`. `POST /auth/social/link` attaches an identity to the
  signed-in account (no tokens minted; 409 when the provider is already attached elsewhere).
  Removal is guarded by `409 LAST_LOGIN_METHOD` when no phone, username + password or other
  provider remains. Telegram is display/remove only until its Login Widget ships. Verified:
  backend 78 suites / 1082 tests, build + eslint; web eslint + `tsc --noEmit` + `next build`;
  live curl of the status/link/unlink endpoints and a headless Chromium walk of the settings
  rows (Add + chevrons, popup disable/re-enable, foreign-nonce rejection).

- **Web social login wired end to end (Google & Facebook; user + admin).** The backend
  endpoints existed but no client called them and every social button was inert.
  `GET /auth/social/:provider/url` now accepts a `redirectTo` (origin-checked against
  `FRONTEND_ORIGINS`, failing closed in production), and `POST /auth/social/callback`
  accepts an additive `mode: 'user' | 'admin'` — admin mode signs in an existing staff
  account only and never creates one, and every failure answers the same 401. Social
  identities link on `user_auth_providers.providerAccountId` (the Supabase user id) before
  email, and a login is rejected unless Supabase reports a confirmed email and the token's
  identity matches the claimed provider (closes audit M1). The web adds
  `actions/social.ts`, a shared fragment-reading `SocialCallback`, the
  `/[locale]/auth/callback/[provider]` and `/wanderer/auth/callback/[provider]` routes, and
  wires the Google/Facebook buttons. A click opens the provider in an `about:blank` popup;
  every action button (Login, Telegram, Apple, Google, Facebook) disables while the form
  fields stay editable (the clicked social button shows a spinner), and closing the popup
  re-enables the buttons without a reload. The callback completes in the opener and closes
  the popup, falling back to the full-page flow when popups are blocked. A host-only
  `social_oauth_pending` cookie binds the callback to the browser that started it.
  Telegram/Apple remain inert. Setup: `docs/social-oauth-setup.md` (Supabase Redirect URLs and
  `FRONTEND_ORIGINS` are required in production). Verified: backend 78 suites / 1067 tests,
  build + eslint; web eslint + `tsc --noEmit` + `next build`; headless Chromium checks of both
  start buttons, the popup open/disabled/re-enable cycle, the fragment strip, the CSRF guard
  and both error paths.

- **Multi-value product-spec fields (phones/tablets).** A template field can now hold several
  rows under one label — a phone's 2G/3G/4G/5G band lists differ per regional model (A3296,
  A3084, …), and the same stacked shape appears in Build, SIM, Internal, the two camera Modules
  lists, Sensors and Charging. The admin editor exposes **+ Add value** with a remove control per
  extra row on those fields; the validator accepts repeated labels inside a template section
  (unknown labels and duplicate section titles are still rejected), and the public page shows the
  label once with each value on its own line. The phone/tablet Misc template now follows the
  reference — Colors / Models / SAR / SAR EU, with no Price field (an already-stored Price row is
  kept as Additional details) — and Body gains an explicit **IP rating** field for the reference's
  unlabelled IP68 note. Each row keeps the existing 500-character value cap; no migration —
  the `spec_groups` row array already supported it.
- **Paid "Verified Account" badge + checkout success screen.** `verifiedAccount`
  is derived from an active paid `user_subscriptions` row (no stored flag, no
  migration) and is returned additively by `GET /users/by-username/:username`,
  `/users/me` and `/auth/me`, and as `sellerVerifiedAccount` on feed, detail and
  trending listing rows. The web renders a white/purple pill on ad cards, a
  purple check beside the public-profile and `/me` names, and the pill on the
  ad-detail seller card; the previously unconditional rosette is now
  conditional. Checkout replaces the activation spinner with an explicit
  "Payment successful" card carrying **Back to profile** and **My
  subscriptions**, adds Back to profile to the activated and failure states,
  and keeps a 15 s status read alive for 30 minutes so a confirmation that
  lands after the QR expires still updates the page.
- **Trusted product specs (admin-managed, in-house).** A new `product_specs`
  table (migration `0044_rapid_skaar`; one row per `models` row, grouped
  label/value `spec_groups` JSONB, `is_published`) backs GSMArena-style spec
  pages written by staff — nothing is scraped and no external link is used.
  `GET /api/v1/products?q=&limit=` (public) powers product search and the
  phones post-form picker; `GET /api/v1/products/:brandSlug/:modelSlug`
  returns page one. `/api/v1/admin/products` is `@Roles('admin')` CRUD with
  `modelId` immutable and duplicates answered `409`. `listings` gains a
  nullable `product_model_id` (FK → `models`, `ON DELETE SET NULL`); create
  and update validate that the target spec is **published**, and
  `GET /listings/:id` embeds `product: { modelId, brandSlug, brandName,
modelSlug, modelName } | null`. The `phones` `field_schema` declares a
  required `productSpec` key: the post form's picker searches the published
  catalogue, resolves a pasted product URL (`/en/product/apple/iphone-16`),
  auto-fills Brand/Model when empty, and clears the link when either changes;
  submit refuses an empty picker. The listing detail shows "View full specs",
  the search page shows a Product specs section above the ad results, and
  `/product/[brand]/[model]` renders the grouped specs plus active ads for
  that model. Admin UI: `/wanderer/dashboard/products` (Attributes → Product
  Specs) with a dynamic group/row editor. No image upload in v1 — the model's
  existing image is used through `DbImage`.
- **Product Specifications: family-scoped spec pages.** The freeform
  "Product Specs" surface becomes a top-level admin section —
  **Product Specifications** → Cars, Motorcycles, Phones, Tablets, Smart
  Watches (`/wanderer/dashboard/product-specifications/<family>`; the old
  `/wanderer/dashboard/products` redirects to Cars). `product_specs` gains a
  `family` enum column (migration `0047_luxuriant_earthquake`, backfilled
  from each model's family subcategory with a phone fallback). Cars and
  Motorcycles use the old freeform group/row editor — staff add any section
  and field, so ICE and BEV specs fit without a schema — while Phones,
  Tablets and Smart Watches keep fixed templates from
  `src/products/spec-templates.ts`, rendered from
  `GET /admin/products/template/:family` (`mode: template | freeform`) with
  blank fields never rendering. The API also gains `?family=` on the
  product lists. Create requires the model to be linked to the family's
  listing subcategory; templated families reject non-template groups
  (`INVALID_SPEC_SECTION`) except for legacy groups already stored on a row. `productSpec` is now required on `cars-for-sale`,
  `motorcycles-for-sale`, `phones`, `tablets` and `smart-watches`, and the
  post-form picker is scoped to the subcategory's family. The listing
  create/update path also rejects a spec from another family.
- **Product pages can carry their own image.** `product_specs` gains an
  `image` column (migration `0048_lucky_harrier`); the admin create/edit
  dialogs upload through a new staff-only `product` sign scope, and the
  public product page and picker prefer it, falling back to `models.image`.
  Product images render contain-fit (no square crop): a wide admin preview
  and a 384×256 public header panel.
- **Product spec pages redesigned.** `/product/[brand]/[model]` gets a
  hero (4:3 contain image, brand eyebrow, 32/40 model name, Trusted-specs
  badge, family/fuel chips) and two-column spec cards with uppercase
  section headers. The page uses a scoped `product-type` type scale so its
  headings stay larger without changing the app-wide 20/28 titles.
- **Trending listings replace the mock home Top Ads.** `GET /api/v1/listings/trending`
  (`limit` ≤ 20, `windowDays` ≤ 30) ranks live listings by weighted engagement from
  `listing_events` (view 1, chat/call/show_contact 3, apply_job 5 — impressions are
  deliberately excluded) plus likes/saves at 2 each (owner self-reactions excluded),
  filters through the feed's `liveConditions()`, and fills the tail with the newest live
  ads. The home carousel is now `components/ads/TrendingAds.tsx` (label "Trending" /
  "កំពុងពេញនិយម"), driven by `getTrendingListings`; the 10 `TopPosts` mocks and the
  unused `HighLightAds` component were deleted. No migration — ranking reads the
  existing tables.
- **Superadmin-managed storefront banners.** `advertisements` (migration
  `0042_omniscient_cloak`) holds one row per banner: a `placement`
  (`home | all_ads | category | subcategory | listing_detail`), the Storage image
  path, an optional click-through, alt text, sort order and an active flag.
  `GET /api/v1/advertisements?placement=` is public and returns active banners
  only; `/api/v1/admin/advertisements` is super_admin-only CRUD. The dashboard
  page is `/wanderer/dashboard/advertisements` — hidden from regular admins the
  same way Team is — and uploads through the new staff-only `advertisement` sign
  scope. On the storefront the five hardcoded banner `<Image>` blocks are
  replaced by `components/ads/AdvertisementCarousel.tsx`: an embla carousel that
  rotates when a slot holds several banners, pauses on hover/focus, honours
  `prefers-reduced-motion`, and renders nothing when a slot is empty.
- **The storage bucket allows only `image/jpeg | image/png | image/webp`**
  (5 MB cap); `image/gif` is refused with `invalid_mime_type`. Animated WebP is
  allowed, so the old 2.1 MB animated `flag-animation.gif` was re-encoded as a
  381 KB / 25-frame WebP and keeps its animation. Allowing GIF would be a
  Supabase bucket-settings change, not a code change.
- **Expiry warnings for ads.** An hourly `ListingExpiryService` sweep (BullMQ
  `listing-expiry` queue) notifies an ad's owner through the existing
  notification feed at T-3 days (`listing.expiring`, "expires in N days") and
  once after the lapse (`listing.expired`, only for ads that expired in the
  last 24 h so a deploy never notifies every historical lapse). Each notice is
  deduped by `(listingId, expiresAt)` in `notifications.data`, so a renewal —
  which moves the date — earns a fresh warning. Manage Ads shows the same
  3-day warning as an "Expires in N days" chip on Active rows. No migration;
  the sweep only reads listings and writes notification rows.

### Changed

- **Bakong payments are polled on demand by one poller, not by a self-rescheduling chain** (`Plans.md`, "Bakong
  demand-driven polling"). Issuing a checkout now emits a local `payment.issued` event that arms
  `PaymentReconciler`: it checks every 5 s for the first minute, every 15 s while the checkout stays pending, and
  falls back to the 60 s safety sweep when nothing is open. The outbox → BullMQ → Bakong → outbox chain is retired,
  so a KHQR left open no longer writes up to ~25 outbox rows and Redis jobs (≈75 before back-off). An unpaid
  checkout is now abandoned at its own expiry plus 30 s (Bakong's `charge()` now stamps `expires_at`, as ABA's
  does) instead of after a flat 15 minutes; the provider is still asked first, so a payer at the deadline settles.
  Attempts we gave up on (`POLL_EXPIRED`) are re-asked about every 5 minutes inside the existing 24 h grace instead
  of on every tick. Fixed: the reconciler read candidates oldest-first with one shared limit of 100, so with many
  abandoned checkouts the payer actually waiting could be skipped; pending and recoverable attempts are now read
  newest-first with separate caps. `GET /payments/:id` also nudges an open Bakong checkout along (at most one
  Bakong call per attempt per 5 s, after the ownership check; the response still comes from the database).
  `BAKONG_POLL_INTERVAL_MS` and `ChargeResult.poll` are removed (an old value in `.env` is ignored). Rows and
  delayed jobs written before the switch are drained by a no-op handler, not retried to failure.
- **Older messages are one notice, and tabs off `/chats` keep the backup complete** (`Plans.md`, "Keep E2E, stop the
  wall"; design in `docs/e2e-encryption.md` section 9c). A run of messages sent before this device joined is now a
  single notice with a count instead of one identical note per bubble, with text that depends on whether the backup
  is locked with a passcode, ready, or locked without one. Opening such a thread on a locked device re-opens the
  passcode dialog each time; "Not now" silences it for the browser session. The leader tab also uploads pending
  plaintext when the tab is hidden. Together with the catch-up decrypt (a tab on any page caches what it
  receives), the backup now holds messages that were received but never displayed. Not browser-verified: the
  "ready" and "locked, no passcode" notice states and the flush itself.

- **A chat partner is never "not set up yet"** (`Plans.md`, "Signal-model key availability"; design in
  `docs/e2e-encryption.md` section 9b). (1) The browser registers its E2E device as part of signing in
  (password and OTP login, OTP registration), not when a layout happens to render. (2) A user who went quiet
  is still reachable: when none of a user's devices was seen within 30 days, their 2 most recently seen
  non-revoked devices stay targets (`loadTargetDevices`, the one helper behind the devices list, the bundle
  fetch and the send-path set check). (3) A message to someone with no device at all is **held** in the
  sender's browser ("Waiting for <name> to join secure chat"), retried by a loop that only runs while
  something is held, sent at most once, and shown as "not sent" after 14 days; the first one sends a
  content-free in-app nudge (`POST /chats/e2e/nudge/:userId`, 24 h per sender and recipient). (4) A visible
  tab re-runs the device heartbeat every ~6 h, asks for persistent storage, and shows a notice when the
  browser repeatedly cannot create keys. The "Ask them to open Messages once" error is gone in all six
  locales. Nothing is ever sent in the clear. Known gaps: no Telegram nudge (no messaging channel exists);
  a message to a stale device is readable only if that person returns on the same browser; the
  release-on-registration path is unit-tested but was not exercised against a real registering account.

- **Chat "share location" opens a map picker.** The Location tile opens a dialog with a map; "Use current
  location" is the only thing that asks the browser for GPS (inline messages for denied, timeout,
  unavailable and unsupported). `LocationMapCanvas` gained an optional `flyTo` prop.

- **Hidden tabs no longer poll the backend** (Vercel usage investigation; plan in `Plans.md`). The backend runs
  as a container that scales to zero within about a minute, and a hidden tab's throttled timer fired the E2E
  backup sync and approvals poll once a minute, which is just slow enough that **every call cold-started the
  whole backend (~6 s to boot, 8 boots in an 8-minute sample from one parked tab)**. `hooks/use-e2e-backup.ts`
  now runs them through `lib/polling/visible-poller.ts`: no timer or request while the tab is hidden, an
  immediate catch-up on return (only if the last run is older than the interval), and the account-level
  sync runs in one visible tab per browser (Web Locks; browsers without it keep every tab polling). The 20 s
  approvals poll stays per tab and is deliberately **not** slowed, because a poll slower than the ~30–60 s
  warm window would boot the backend on every call. The 10 s "waiting for another device" poll is gated too.
  Added `pnpm --filter web test` (Node's built-in `node:test`, no new dependency) and
  `allowImportingTsExtensions` in `apps/web/tsconfig.json` so the test can import its `.ts` module.

- **Backup and approvals are pushed over the WebSocket instead of polled** (`Plans.md`, "Push instead of poll").
  `E2eBackupService` now publishes `e2e.history_requested`, `e2e.history_resolved` and `e2e.backup_updated` as
  `notification` frames to the user's own tabs, after the write commits, with ids only (best-effort; a failed
  publish never fails the request; an idempotent repeat of a history request publishes nothing). The web hook
  (`lib/e2e/push-events.ts`) maps each to an ordinary read and ignores its own device's events. While the socket is
  up the polls drop to a 5-minute safety net (1 minute while waiting for another device to approve); with no socket
  they keep today's 20 s / 60 s / 10 s, and every (re)connect catches up because a missed frame is not replayed.
  A push only nudges the one leader tab's sync, so tabs still never pull in parallel. **Backend and web must
  deploy together**: a new web build against an old backend simply keeps its 5-minute poll and would be slow to
  notice an approval.
- **An abandoned visible tab behaves like a hidden one.** After 30 minutes without pointer, key, scroll or touch input
  (`lib/polling/attention.ts`, `ATTENTION_IDLE_MS`) the socket closes and every poller stops — the E2E ones through
  `visible-poller.ts`, and the chat fallbacks (inbox, unread badge, thread delta, checkout) through the new
  `use-tab-attention.ts`, because "socket down" alone would otherwise re-enable them in a tab nobody is looking at.
  The first input, or the tab being shown again, reopens everything and the reconnect refreshes inbox and unread. A
  message that arrives meanwhile appears on that first input, not before.

### Removed

- **New-device approval is gone; the backup passcode is the only restore path.** A device that cannot read older
  history can now only unlock the account's backup key with the passcode. Removed end to end: the
  `history-requests` API (`create` / `mine` / `pending` / `approve` / `decline` / `consume`), the
  device-to-device key envelope and its Double Ratchet handling, the `e2e.history_requested` /
  `e2e.history_resolved` push events, the approval dialog and "Ask my other device" UI, and the
  `chat.e2e_history_requests` table (migration `0041_brainy_plazm`). The only realtime hint left is
  `e2e.backup_updated` (another device uploaded segments), which still drives a sync.

### Changed

- **A backup passcode is required before the backup is usable elsewhere.** It was optional (a dismissible nudge);
  without approval, a backup with no passcode is a dead end — a new device has no way in. A device that holds the
  key and has no passcode now gets a forced, non-dismissible "Set a backup passcode" dialog. Accounts that already
  have a backup without a passcode keep working on the devices that hold the key; setting one there makes the
  history restorable on a new device. The locked-device copy now explains the passcode-only path (and what to do
  when no passcode was ever set) instead of offering approval. A locked device now asks for the passcode when the
  user first opens a conversation (once per browser session); the per-message "Restore chat history" link was
  removed, and the undecryptable-message note now points at the backup passcode instead of another device.

### Known issues

- **Bakong polling has not run against a live Bakong or a booted app.** The new poller, the throttled read and the
  legacy drain are covered by unit tests with mocked database and provider (backend `jest`, 64 suites / 860
  tests), `nest build` and `eslint`; the `payment.issued` wiring (an `EventEmitter2` injected into
  `PaymentProcessor`) and the `expires_at` stamp in Bakong's `charge()` are not unit-testable here (`effect` is
  ESM-only under Jest). Batching many MD5s into one call (`check_transaction_by_md5_list`) is **not** built: NBC's
  published guide does not document it and no source gives a schema. Also unverified: a third-party note of a daily
  request limit on the Bakong Open API — if real it caps how many checkouts can be polled, so confirm it on the
  Bakong developer portal before real traffic. A serverless instance still only polls while it is alive: a QR paid
  while nobody is on the checkout page waits for the next request or boot (`Plans.md` Task 2.1).
- The cause of the high Vercel usage is inferred from a 50-row log sample and the code: per-project and
  30-day numbers need the paid Observability Plus add-on, and billing was not readable. Re-measure after
  this ships (`Plans.md`, Task 0.1 / 4.1). The `APP_ROLE` worker split (Task 2.1) and the hosting decision
  (Task 3.1) are still open. The push work is covered by unit tests but has **not been exercised in a browser or in
  production** (`Plans.md` P0.1 / P2.2 / P3.1): confirm the socket connects, then deploy backend and web together.

## 2026-10-24 — Encrypted-only chat, history restore, idle background work

### Changed

- **Background work no longer runs when there is nothing to do** (Vercel resource audit; plan in `Plans.md`).
  The outbox worker used to claim from `outbox_events` every 2 s forever; it now asks the database when the
  next row is due (`OutboxService.msUntilNextDue`), sleeps until then, and re-arms after every drain that
  handled events. `OUTBOX_POLL_INTERVAL_MS` is now the **longest** idle sleep (default 2000 → 30000), which
  only bounds the latency of a lost wakeup or a producer in another process — lower it for an API-only /
  separate-drainer topology. A failed peek falls back to a plain claim.
- **Bakong poll chain backs off.** Rounds are the base interval (4 s) for five rounds, then 2×, then 4×
  (cap 30 s), and the last round lands just after the QR expires. One abandoned checkout writes ~25
  outbox rows instead of ~75. Payloads gained optional `round` / `delayMs`; older queued payloads still work.
- **`PaymentReconciler` relaxes when idle.** With no unresolved attempt and nothing to activate or expire it
  ticks every `PAYMENT_RECONCILE_IDLE_INTERVAL_MS` (new, default 60 s) instead of every 15 s; any activity
  returns it to `PAYMENT_RECONCILE_INTERVAL_MS`. The boot tick is still immediate.
- **No housekeeping at boot.** The outbox retention sweep and the account purge no longer run the moment the
  process starts; the first run waits a jittered 1–2 minutes, so a restart loop is not a query loop.
- **Checkout fallback polling** (socket down only) backs off 5 s → 15 s and pauses while the tab is hidden.
- Outbox worker logs a one-line stats summary (due-time checks, drains, events) every 10 minutes.
- **Backup API is device-scoped.** `POST /chats/e2e/backup` and
  `GET /chats/e2e/backup/segments` now require an active `deviceId`;
  `POST /chats/e2e/history-requests/:id/consume` only succeeds for the requesting device and
  returns `404 E2E_REQUEST_NOT_FOUND` / `409 E2E_REQUEST_NOT_PENDING` instead of a silent
  `{ ok: true }`. Init, segment upload and segment list are throttled (10 / 30 / 60 per
  minute).
- **v2 send device-set check is race-free.** The active-set read is repeated inside the
  message insert transaction under per-user Postgres advisory locks shared with
  `registerDevice`, so a device registering mid-send surfaces as `409 E2E_DEVICES_MISMATCH`
  and is retried by the client instead of silently missing an envelope.
- **"Update this contact to your ads" now carries the location too.** With the switch ticked,
  `PATCH /users/me` copies the profile's province/district/commune, address and — when the profile
  has one — map pin onto every non-deleted ad the user owns, alongside the contact name/phones/email
  it already copied. The settings form had been making Location and Address required for this switch
  while the backend deliberately skipped them, so ads stayed empty. A profile with no pin leaves each
  ad's own pin untouched, and an unticked switch still never touches listings. The **post form now
  prefills Location and Address from the profile too** (same resolved cascade, same saved address),
  each block still gated on the subcategory's own `field_schema`; the map pin is not prefilled.
- **Free plan is now one account-wide cap.** `free_plan_settings.other_ads` is the free plan's
  total live-ad allowance (relabeled "Total Ads"); the `free_plan_ad_limits` rows are sub-limits
  inside it — at most this many of the pool may sit in one subcategory/category, and a value above
  the total never binds. A held group keeps its own pool: a Property (1000 ads) subscriber still
  gets at most 2 cars, because car ads are outside that group. The Manage Ads cards now read
  active live ads against the summed pools (free total + every held group), a **Hidden** tab lists
  ads restricted over the allowance with delete/upgrade recovery, restricted ads 404 on their
  public link, owner deletes reconcile immediately, and a restricted ad whose window lapsed can be
  renewed. Renewals are pooled the same way (one plan's `renews` is shared by every ad in its
  pool) and reset on a rolling 30-day window — migration `0046_noisy_wolverine` adds
  `listing_renewals`, one row per renewal spent, cascading with its listing and user. The allowance
  is enforced when the ad is created as well as when it is published, so an over-limit post never
  creates a row; if a publish is refused after all, the web rolls it back. The web has no draft
  surface. The ad-cap change itself needs no migration.
- **Subscription catalog collapsed to group → tier → term (migration `0045_collapse_subscription_plans`).**
  The empty `subscription_plans` level is gone: `subscription_packages` is now one fixed tier per
  group (the `subscription_tier` enum `bronze|silver|gold`, unique on `(categoryId, tier)`) and
  carries the limits; `subscription_terms` stay as the purchasable rows, constrained in admin to
  fixed 3/6/12-month durations (12 stored as months, displayed "1 Year"). The four dashboard pages
  (Categories / Plans / Packages / Terms) are replaced by three pages under
  `/wanderer/dashboard/subscription`: **Subscriptions** (groups + coverage), **Tiers** (limits) and
  **Terms** (prices); Free plan keeps its own page, and the sidebar section is now **Premium**.
  The migration backfills each package's group and tier from its old plan
  (failing loudly on unmapped names or duplicate tiers), sets the tier order, normalizes year terms
  to 12 months, and retires every term outside 3/6/12 months (rows kept; live subscriptions keep
  their frozen snapshot). The public catalog and `/subscriptions/me` no longer return
  `planId`/`planName`; customer pricing, checkout and the profile/`/me/subscriptions` views render
  package + term, checkout now refuses inactive groups, and the unenforced Videos/Auto-Renews rows
  are no longer shown on customer surfaces.
- **Admin catalogue tables rebuilt on a shared kit.** Models, Brands, Categories and
  Subcategories drop the raw-UUID ID column (Copy ID now sits in each row's menu), lead
  with a logo/initial + name cell, show category and sub-category chips and one formatted
  Updated date, and gain click-to-sort headers, whole-row search (name, slug, brand,
  category, sub category), category filters (plus brand on Models) and a shared
  pagination footer — `components/dashboard/admin-table.tsx` plus `admin-page.tsx`.
  `getAdminModels` now derives a model's category from its own subcategory rows instead of
  a brand's first link (the bug that listed phones under "Computers & Accessories"), and
  Brands lists every category a brand spans. The Models delete dialog no longer says
  "Delete Brand"; the Subcategories one no longer says "Delete Category".
- **Admin Users rebuilt on the same shared table.** Seven columns instead of ten (the ID moved
  into the row menu, the constant Role column dropped, Created/Updated collapsed into one
  Joined date), a round avatar + name + email cell, `@username`, click-to-sort headers,
  pagination at 20, and the All / Premium / Normal tabs kept. Two real fixes: the phone column
  no longer doubles the `+` (`++855…` → `+855…`), and the row menu's View no longer
  concatenates the username with the UUID — it opens the public profile at
  `/{locale}/{username}`.
- **Admin report queues rebuilt.** Report Users and Report Posts share one status badge, drop
  the report-UUID and reviewer-UUID columns, show the reviewer under the status, format the
  created date, clamp the description with the evidence thumbnails beneath it, and move the
  actions into the shared row menu (View profile/post, Approve, Reject, Copy ID). Fixes: the
  created column no longer prints a raw ISO string, the reviewer column shows the reviewer's
  name, and Report Users' View Profile opens `/{locale}/{username}` instead of concatenating
  the display name with the target's UUID.
- **Admin navbar: storefront-style language picker and a real notification queue.** The language
  trigger is now the current locale's flag with a flag radio list (`/flag/uk.png`,
  `/flag/khmer.png`), matching the storefront selector while keeping the admin cookie switch. The
  bell no longer shows hardcoded mock entries: it counts pending user/listing reports (same
  react-query keys as the queues) and opens a right-side drawer of report cards that link to the
  owning queue.
- **Admin sidebar logo no longer clips in the icon rail.** `SidebarHeader` drops to 7 px padding
  while the sidebar is collapsed (`group-data-[collapsible=icon]:p-[7px]`) and centres the mark,
  so the 32 px tile no longer overflows through the old 16 px padding; the expanded header is
  unchanged.
- **Collapsed admin sidebar groups now open a dropdown.** In the icon rail the sidebar primitive
  hides inline sub-lists, so Attributes, Manage Users, Subscriptions and Reports expanded into
  nothing; each now opens its children in a right-side menu from the icon, while the expanded
  sidebar keeps the inline collapsible.
- **Job applications: hiring is a conversation, not a row action.** Both `/me` job lists drop
  the application-status machinery — the poster's rows keep only View Resume + Message, the
  status pills (New/Viewed/Hired/Rejected) and both status filters are gone — because applying
  already opened the chat thread, which is where the recruiter/interviewer decides. The button
  label now reads "View Resume".
- **Body Types (and the other attribute pages) rebuilt on the shared admin table.** Six columns
  instead of ten — icon/initial + name (+ Khmer name), slug, category chip, sub-category chips,
  formatted updated date, row menu — with sorting, search and pagination from the kit. The
  add/edit dialog and the Years read-only mode are unchanged.
- **Team page rebuilt on the shared admin table.** Member (avatar + name + email), @username,
  phone, role badge (Super Admin/Admin), status, one Joined date and the standard row menu
  replace the raw-UUID ten-column table; sorting, search, tabs and pagination come from the kit.
- **Advertisements: admin page on the shared kit, storefront dots on the brand colour.** The
  admin table now has a 4:1 banner thumbnail with alt text and a Live/Hidden line, placement
  chips, a truncated link, order, the brand-blue active switch and the standard row menu, with
  search, sorting and pagination; the storefront carousel's active dot uses `#00a0e9` instead of
  white.
- **Admin dialogs cap at the viewport and scroll internally, with one button language.** Every
  `DialogContent` is now `max-h-[calc(100svh-2rem)]` with an internal scroll, and the footer is an
  in-flow bar at the end of the form sharing the dialog's surface — symmetric around its buttons,
  never overlapped by content — so a long form no longer stretches the dialog past the screen.
  Cancel buttons are the neutral outline (the red/blue fills across the Attributes, Users, Team
  and Feedback dialogs are gone) and primary actions use the theme blue.
- **Users Subscription rebuilt on the shared admin table.** Subscriber, phone, plan + price/payment,
  category chip, usage (ads / renews / auto), one subscription period, status and the row menu
  replace the 15-column table whose Status/Action columns fell off-screen; search and sorting come
  from the kit and the Grant dialog's Cancel is neutral.
- **Admin Listings rebuilt on the shared table with category filters.** A thumbnail + title (with
  the moderation reason beneath), seller, resolved category names, price, soft status and
  open-report badges, one created date and the row menu (View listing / Remove / Restore / Copy ID)
  replace the old table with its yellow/red buttons. New **Category** and **Sub-category** filters
  ride two additive `GET /admin/listings` params (`categorySlug`, `subcategorySlug`); the admin
  table kit gained a `serverPagination` mode so the footer drives the API page. The status tabs
  carry counts computed under the current search/category filters, capped at **99+** (the shared
  `formatCount` also feeds the Users, Team and Users Subscription tab badges). Status and report
  badges use **solid tints**: Tailwind's alpha colours (e.g. `orange-500/10`) render teal fringe
  pixels on Chrome's rounded pills — also fixed on the Users Subscription status badges.
- **Manage Ads: the ad list is split from the controls card and rows gain an
  actions menu.** The header, plan stats and Active/Expired tabs keep their own
  card; the ads (and the loading/empty states) render in a separate section
  below it. Each row's three-dot menu offers **View ad**, **Renew ad**
  (re-publish — 30 more days, one plan renewal, confirm dialog), **Share**
  (copy-link dialog) and **Delete ad** (soft-delete, confirm dialog), wired to
  the existing backend endpoints; a successful action reloads the tab and the
  plan summary. The page also renders through the existing `Me.manageAds`
  namespace (en/km) after reading as hardcoded English since the merge.
  Edit-listing ("no edit flow yet") and "mark as sold" (no such status) are
  deliberately absent.
- **Profile tabs render populated results as list rows.** Likes, Saved and
  Manage Ads moved from the 2–4 column card grid to full-width rows
  (thumbnail, title, location, price — plus a like/save toggle on Likes and
  Saved), matching the captain's reference. Empty tabs keep the centred
  "No Result!" card; the Jobs and Subscriptions tabs were already lists.
- **Listing detail's seller button reads "Chat"; the owner sees a note instead.**
  `Chat.messageSeller` (the default label of `ContactSellerButton`) is now
  "Chat" (km was already "ជជែក"), and the own-ad note on the seller card reads
  "This is your own ads - buyers will see 'Chat' here" (`Post.ownAdNote`; the
  km copy now quotes 'ជជែក'). Labels only — the chat flow is unchanged.
- **Typography scale trimmed: page titles 20px, section titles 16px.** The
  captain found the 2026-10-23 scale too large away from the landing page.
  `type-page-title` is now 20/600/28 and `type-section-title` 16/600/24 (base
  `h1`/`h2` follow); the homepage alone keeps the display sizes — 24/32 and
  20/28 — through a `home-type` context class on its wrapper. Ten page-title
  `h1`s that still hard-coded `text-2xl` (the subscription dashboard, listings,
  feedback and users-subscription pages, `/feedback`, `/settings`,
  `/me/membership`) now use the role class, so no non-home page title exceeds
  20px.
- **`super_admin` is now a governance tier, not a bigger admin tier.** The
  captain's rule: a superadmin manages the dashboard & stats, reports, team &
  roles, advertisements and feedback — nothing else. `RolesGuard` matches roles
  literally, so `@Roles('admin')` now **excludes** a `super_admin`; the
  catalogue, subcategories, brands, models, listings, attributes, subscription
  config, user-subscriptions and the admin payment route were narrowed to
  `@Roles('admin')`. `AdminController` (stats **and** users) and
  `ReportsController` still name both roles — the Team page is built on
  `/admin/users`, so that endpoint cannot be closed to super_admin without
  breaking team management (the staff-vs-user boundary there stays enforced by
  `assertCanManageUser`). The admin sidebar mirrors the split: each menu item
  declares a `roles` list, and the Subscriptions group is admin-only. A
  dedicated `superadmin` account was created for this tier; `admin` and `asdf1`
  remain plain admins.

- **Chat is encrypted-only for new messages.** `ChatService.sendMessage` rejects a payload
  with neither `e2eHeader` (v1) nor `e2e` (v2) (`Encrypted messages are required`), requires a
  body, and refuses the legacy public-bucket `imagePath`
  (`Unencrypted chat images are not accepted`). The public-image path (`SupabaseService`/`ConfigService` dependency, `bucket`
  getter, `assertOwnedChatImagePath`) is removed. Historical plaintext and image rows still
  read normally.
- **Web send path has no plaintext fallback.** Images and voice notes need
  `E2E_ATTACHMENTS_ENABLED` and a registered v2 device; otherwise the bubble fails visibly with
  `E2E_UNAVAILABLE`. `createOutboxEntry` (images + optional voice blob) replaces
  `createImageOutboxEntry` in `lib/e2e/attachments/send.ts`.
- **Chat thread redesign.** The workspace stays inside the normal app shell (the `(chat)`
  layout still mounts `NavBar`) and takes the viewport minus the navbar, as a dark two-pane
  panel. The thread pane gains quick replies above the composer and a compact pending-listing
  row with immediate send. Quick replies are an empty-thread onboarding row: they are shown
  while a conversation has no messages, and dismissing them with the X is remembered per
  conversation in `localStorage` (`chat:quick-replies-dismissed:<scope>`), so every new chat
  introduces them again. The inbox column keeps its previous design ("Inbox" title, chevron
  collapse, 300/340px default width). Only its portaled menu and delete dialog pick up the
  panel's dark scope.

### Added

- **App-wide encrypted-history restore.** `E2eBackupProvider` now mounts in the `(user)` and
  `(chat)` layouts and owns the single backup instance (status, uploads, pulls, the
  approval prompt and the restore dialogs), so history backs up and restores even when the
  chat page is closed. A locked (new) device automatically asks the account's other devices
  for the backup key once per session, and an incoming request is approved from any page.
- **Actionable "not on this device" bubble.** A message this device cannot decrypt now
  offers `Chat.message.restoreHistory` ("Restore chat history"), opening the passcode or
  other-device restore flow instead of ending at a dead-end note. Newly decrypted plaintext
  is uploaded to the backup promptly via the `E2E_PLAINTEXT_CACHED` window event.
- **Encrypted rich content** (`lib/e2e/chat-content.ts`, marker `khmer24-chat-content` v1):
  shared locations and listing-only messages are sealed inside the ciphertext. New
  `location-card.tsx` (OSM link, no map tiles).
- **Voice notes**: MediaRecorder capture in the composer (60 s / 8 MB caps, MIME negotiation,
  tracks stopped on stop/unmount), sent as an encrypted `kind: "file"` with
  `purpose: "voice-note"` and `durationMs`. Inbox previews read "Voice note" / "Shared
  location" instead of the decrypted JSON.
- **Voice note controls** (`components/chat/voice-player.tsx`, shared by the received bubble and
  the composer preview):
  - play/pause, a draggable seek bar, elapsed/total time and a 1× / 1.5× / 2× speed toggle;
  - download on received notes;
  - only one note plays at a time;
  - a duration probe so MediaRecorder WebM files (which report `duration = Infinity`) can seek.

  Recording shows `0:12 / 1:00` against the cap and has a Cancel button that discards the take.
  New i18n keys `Chat.voice.*` and `Chat.composer.cancelRecording` in all six locales.

- **Location sharing** on an explicit click only (`enableHighAccuracy`, 10 s timeout), with a
  staged preview like images and voice.
- **"Last active …"** in the thread header from `ChatUserSummary.lastSeenAt`
  (`users.last_seen_at`, coarse — 5-minute activity throttle).
- **Browse More Filters: the mock's vehicle block, wired end to end.** On a vehicle
  subcategory the shared dialog now shows Brand, Model (disabled until a brand is picked),
  Year (minimum/maximum), Tax Type, Condition, Colour, Transmission, Engine Type and Body
  Type — each gated on that subcategory's own `field_schema` and sourced exactly like the
  grid/form (linked `bodytypes`, the managed/global `colors` rule, `enginetypes`, the
  generated `years`). Every field edits the same URL params the browse grids and the bar
  chips use, so a grid pick shows up in the dialog and counts on its badge, and a dialog
  pick updates the grids/chips. `GET /listings` gains four additive optional filters —
  `model`, `taxType`, `color`, `transmission` (display-name equality on `attributes`, values
  bound as parameters) — so the fields really filter. The header follows the mock (✕ left,
  centred title, Clear right), controls are h-11, and the segmented groups use the sampled
  mock colours (`#00a0e9` selected / `#707685` rest).

### Fixed

- **Product spec sections now stack full width.** The public product page laid the sections out in
  a two-column grid, so unrelated blocks (Network beside Launch) read as a comparison; each section
  is now one full-width card after another, per the captain's 2026-10-31 layout call. Multi-value
  cells (4G bands, SIM, camera Modules, …) separate each value with the same divider the spec rows
  use, scoped to the value column and spaced so it never touches the text.
- **Backup-key creation race.** Two first devices creating the account backup at the same
  time could leave the loser holding a key that would never open the account backup.
  Creation now runs under a cross-tab Web Lock, re-reads the status inside it, and clears
  any stored key that fails the server `keyCheck` instead of using it.
- **An approval can no longer be stranded.** After a device approves a new device, the
  backup key is validated and saved before the one-shot ratchet step is committed and
  before the request is consumed; a pull that fails after that is retried by the ordinary
  pull cycle.
- **Backup pulls are no longer silently lossy.** An unreadable segment stops the cursor
  instead of advancing past it, and pulls no longer depend on uploads succeeding.
- A thread opened via `?to=<peer>` before the conversation existed did not fill in when the
  first inbound message created it. `chat-workspace.tsx` now reconciles the cached
  `GET /chats/with/:userId` lookup against the inbox.
- **The web project failed to build on Vercel (`NEXT_NO_VERSION`).** `.vercelignore` excluded `apps/web`, but
  that file is read by every project built from this repo, including the web project (Root Directory =
  `apps/web`), which then had no `package.json`. The exclusion is gone; the backend image build only uploads
  more (~257 MB instead of ~10 MB).
- **Listing-detail spec values now actually filter the feed.** Every row in the Description grid used
  to link to its subcategory page with no query, so clicking Year, Tax Type, Condition, Body Type,
  Engine or Color landed on the unfiltered feed. Each row now carries the filter: year → an exact
  `year_min`/`year_max` range, condition/tax type/engine/color/transmission → their shared filter
  params, and every other attribute key (`bodyType`, `storage`, `jobType`, `bedroom`, `size`, …) →
  the feed's multi-attribute `attrs` JSON object. Links always carry the stored English value, so
  `/km` filtering works while the grid stays Khmer. Clear removes the object and the More Filters
  badge counts it.
- **More Filters is schema-driven for every subcategory.** The dialog rendered its attribute block
  only on vehicle subcategories, so a phone page offered no Brand, Model or Storage and a laptop
  page none of its Storage / Screen Size / RAM / CPU / VGA fields. It now renders one select per
  `select` field the subcategory's `field_schema` declares (plus Brand/Model and the vehicle-specific
  controls), AND-ing the generic ones through the new additive `attrs` query param
  (`GET /listings?attrs={"storage":"128GB","ram":"8GB"}`). Keys are bound as parameters, malformed
  or oversized input applies nothing, and each parsed filter is unit-tested. No schema change.
- **The seller card's email row now hides the address until asked.** The full email was always
  rendered next to a "Show Email Address" button that only logged an analytics event, so the
  control did nothing. It now mirrors the phone row: `c***@gmail.com` until clicked, then the real
  address as a `mailto:` link and the reveal control disappears. An expired ad still hides the row
  entirely.
- **The car post form was missing the Product Specification picker in an environment whose seed
  data predated it.** The form is schema-driven, and `subcategories.field_schema` for
  `cars-for-sale` (plus motorcycles, tablets and smart watches) had been written before
  `productSpecField` existed, so only `phones` carried the key live. The seed source was already
  correct; a targeted `field_schema` sync from `categoriesSeed` (by category + slug) applied it.
  No code change. Production still needs the same targeted `UPDATE` per environment — the seed is
  its only writer.
- **Users Subscription tabs are built from the subscription categories, not a hardcoded list.**
  Category names are free text (e.g. "Auto 8137"), so the old name-matching tabs counted zero and
  filtered nothing, and any category beyond the original five had no tab at all. The admin view now
  also returns each row's `subscriptionCategoryId` (additive field); the tabs count and filter by
  id, so new categories appear automatically, and the strip wraps when it grows.
- **Editing an attribute with an empty Khmer name no longer 500s.** The admin web action sends
  `nameKm: null` for an empty field, and `AttributesService.update` called `.trim()` on it; update
  now mirrors create's null-safe trim (null clears the Khmer name). The same guard was added to
  the category/subcategory update paths, and a regression spec pins both cases.
- **Chat ignored the site theme.** The workspace forced the `dark` token scope on its panel
  (hardcoded `bg-[#1b1b1b]` / `border-white/10`, plus `dark` re-applied to the portaled delete
  menu and dialog), so `/chats` stayed dark in light mode. The panel now uses the normal theme
  tokens (`bg-card`, `border-border`, `bg-muted`) and follows the visitor's light/dark choice;
  the Suspense fallback matches.
- A thread opened via `?to=<peer>` before the conversation existed did not fill in when the
  first inbound message created it. `chat-workspace.tsx` now reconciles the cached
  `GET /chats/with/:userId` lookup against the inbox.
- **Accounts without an uploaded photo rendered a broken avatar.** The shared fallback pointed at
  `ui-avatars.com`, which now answers with `image/svg+xml`; Next's optimizer rejects SVG unless
  `dangerouslyAllowSVG` is set, so every no-photo avatar (navbar account menu, `/me` header,
  public profiles, follower lists, the listing seller card, settings) came back 400 and printed
  its alt text inside the circle. The new `components/common/UserAvatar.tsx` renders the photo
  through `DbImage` and falls back to a brand-blue initials circle instead — no third-party
  request, no broken `<img>`. The `ui-avatars.com` remotePattern is gone.
- **Browse filters gave no visible selection, and the header search ignored the category page.**
  Picking a brand (e.g. MG) hid the whole Brand grid and swapped in its models, so nothing showed
  which brand was applied except the breadcrumb. The pick now surfaces where the other applied
  filters do: the More Filters dialog's Brand select and its badge count it. The brand click
  itself stays a drill-in (grid steps aside, models appear) — like a body-type pick, not a
  toggle. The header search bar's scope chip now follows the page: a category or subcategory page
  reads that category ("Cars For Sale" / "រថយន្តសម្រាប់លក់") and a submit from there searches inside
  it (`/search?q=…&category=…&sub=…`), instead of always starting from "All Categories".

- **Expired listings vanished from browse while still reading as live.** Nothing flips
  `listings.status` when the 30-day window closes, so a lapsed ad dropped out of every feed
  (`liveConditions()`) but `GET /listings/:id` still served it with `status: "active"`, Manage Ads
  still counted it under Active (its Expired tab asked for a status no row ever has), and the
  detail page offered contact as if the offer were live. `findPublicById` now reports the derived
  `expired` status and 404s drafts and owner-deleted ads; `findMine` derives the same status and
  maps the Active/Expired filters to date ranges (`active` excludes lapsed rows, `expired` includes
  both stored-expired and lapsed-active ones); the web detail page shows an expired notice and
  disables contact/apply, and the Expired tab renders the ads with a badge. Unit tests pin the
  derivation and both filters.

- **Product Spec picker: a pasted link now explains itself.** The phones form's field advertised
  "search or paste a product link", but only a published PhsarKhmer product URL resolves; an
  external (GSMArena) link or a product page that is not published failed silently and the list
  just read "No match found". A URL-shaped paste that does not resolve now toasts "That link
  isn't a published PhsarKhmer product…", the placeholder names the source ("paste a PhsarKhmer
  product link"), and the focused field (not only the open panel's search box) accepts a
  keyboard paste.

- **A price of 0 can no longer be submitted.** The price field accepted `0` (`min={0}`, and
  submit only rejected `priceNum < 0`), so a real ad could be published at `$0`. The field now
  requires a value greater than 0 (`min={0.01}`, submit `<= 0`) with the message "Enter a price
  greater than 0". The fix applies to every subcategory that declares a price; existing ads keep
  their stored price until edited.

- **A zero/negative discount no longer renders as a discount.** `"0.00"` is a truthy string, so
  the card and detail mappings treated any non-null discount as real: a `-0%` / `$0 OFF` badge
  and a strikethrough price equal to the price. `toCardPost` and `toPostView` now require a
  positive discount value before setting `oldPrice` or the percentage label, and the form never
  sends a discount unless it is greater than 0.

- **Number fields no longer change on scroll.** Chrome edits a focused `type="number"` input on
  wheel, so scrolling the long post form with the cursor over the price/discount field silently
  walked `1` → `0` (the reported `$0` ads and the stray `0%` discount). The shared `TextInput`
  (number mode) and the discount input now blur on wheel, so the scroll moves the page instead
  of the value.

### Removed

- The no-op Archive menu item and the unused i18n keys `Chat.inbox.archive`,
  `Chat.thread.emptyTitle`, `Chat.thread.attachingListing` and `Chat.thread.sendingVoice` (all six
  locales).
- **Web mock data removed.** Deleted `lib/post-ad.ts`, `lib/categories.ts`, `lib/location.ts`,
  `lib/data.ts`, `lib/users.ts`, `lib/subcategoryGroups.ts`, `lib/brands.ts`,
  `lib/subcategories.ts`, `components/post/PostForm.tsx`, the five mock display components
  (`components/ads/{AdsPhoto,ListAd,NormalAd}.tsx`, `components/Card/TabsCard.tsx`,
  `components/all-ads/AllAdsHeader.tsx`), and the mock `posts`/`users` arrays; feed cards and
  listing detail are real-data only; `/sell` redirects to `/post`; legacy numeric `-adid-` URLs 404. Client chunks drop ~285 KB raw / ~48 KB gzip.

### Docs

- `docs/admin-backoffice-audit-2026-10-24.md`: the admin vs super_admin backoffice audit
  (read-only, no code changes).
- `CHANGELOG.md` introduced. `tasks/todo.md` was reset to open items only, and its history
  rolled up here.
- `ARCHITECTURE.md` added and `CLAUDE.md` slimmed down; the plans under `tasks/` were checked against the code
  and the finished ones deleted (shipped outcome lives here, text in git). `Plans.md` gained the backend
  background-work audit plan.

### Known issues

- The attachment daily quota sums the client's `declaredSize`; only the per-kind cap is
  re-checked against the stored object size.
- A v2 envelope's `wrappedKey`/`header` is stored verbatim, with nothing binding it to the device
  key it claims to target. No safety-number / key-substitution protection yet.
- Backup restoration remains ciphertext-only and device-gated, but there is still no segment
  retention/size quota beyond the route throttles, no device-list/revocation management, and
  a participant still receives every device envelope of a v2 message (device ids/count are
  visible; wrapped keys stay unreadable). A revoked device keeps the backup key and can read
  messages already addressed to it; any authenticated stranger can list a user's active
  device ids and claim one-time prekeys. These are tracked as follow-ups, not fixed here.

## 2026-10-23 — Security audit, moderation, reports, feedback

### Security

- **Admin escalation closed.** A plain admin could reset a super_admin's password, demote,
  suspend or delete one. Every admin user mutation now goes through `assertCanManageUser`
  (`admin/admin-user-policy.ts`): only super_admin manages staff accounts, nobody can
  delete/demote/suspend themselves, and the last active super_admin can't be removed (counted
  under a row lock). Stable error codes (`ONLY_SUPER_ADMIN_CAN_MANAGE_ADMINS`,
  `CANNOT_CHANGE_OWN_ROLE`, `LAST_SUPER_ADMIN`, …). This is Phase 1 of
  `docs/super-admin-todo.md`. The audit log, advertisement ads and workspace settings phases are
  not started.
- **Auth throttles per route**: login/verify/social/telegram 10/min; register, OTP request and
  OTP login 5/min (each sends a paid SMS); refresh 30/min. Telegram payloads are shape-checked.
  Login also matches the lowercased username.
- **Uploads**: user scopes sign into `{scope}/{userId}/`; catalog scopes are staff-only;
  `DELETE /files` is owner-only for non-staff with traversal rejected. Listing photos must be the
  owner's own uploads. Multipart uploads are capped at 5 MB and limited to raster types (SVG was
  accepted before, a stored-XSS risk).
- **Idempotency**: 422 for a different body on completed rows too, 5xx recorded as `failed`
  (not cached), and reclaim of failed/stale rows conditional on `lockedAt`.

### Added

- **Listing moderation** (migration `0040_moderation_feedback`): `GET /admin/listings`,
  `POST /admin/listings/:id/remove|restore`, and the `/wanderer/dashboard/listings` page. Approving
  a listing report removes the listing; approving a user report suspends the account.
- **User reports**: `GET /reports/reasons`, `POST /reports/listings|users`. The report dialogs on
  the storefront submit for real (they were mock).
- **Feedback**: `src/feedback/` (public multipart `POST /feedback`, admin list/delete), with the
  public form and admin page wired.

### Changed

- **Phones**: `addPhone` is transactional and syncs `users.primaryPhone`; `removePhone` promotes
  another phone and refuses to remove the last one.
- Listing create/update are transactional; dropped-photo cleanup touches only the owner's folder.
- Web `serverActions.bodySizeLimit` raised to 32 MB (avatars over 1 MB were rejected by Next).
- **Subscription review fixes** (`f074f5e`, per `docs/subscriptions-review-todo.md`):
  - `reconcileListings` only restores rows still `restricted` and only restricts rows still
    `active`, scoped to the owner, and counts from `RETURNING`.
  - Admin scope and free-plan edits enqueue one coalesced BullMQ job
    (`reconcile-on-config-change` via `EntitlementsScheduler`), replacing the fire-and-forget
    sweep.
  - A concurrent free-plan save returns an honest 409 instead of "Slug already in use".
  - `supersededReason` is typed end to end (`subscription-status.ts`).
  - Shared helpers: `toFreePlanSettings`, `groupBucket`, `describeBucket` and
    `use-admin-category-tree`.
  - User-facing fields renamed to `group*`.
  - New specs for scope/free-plan updates and revoke.
- **Outbox wakeup** (`7f3477c`, per `docs/outbox-wakeup-signal-spec.md`): the generic
  `Channel<T>` is replaced by a small `WakeupSignal`.
  - One process-level fallback timer makes one claim per interval, whatever the worker count.
  - A fallback claim that finds backlog wakes idle peers.
  - A worker stuck in a handler no longer stops polling.
  - Shutdown releases parked workers.
- **CI**: the deploy workflow deploys only the apps the push affects.

### Fixed

- Admin Report Users rendered storage paths as `<img src>`; it now receives `imageUrls`. Report
  Posts "View" opened post `0`; it now opens the real listing.

## 2026-10-14 → 2026-10-21 — Subscriptions and payments

### Added

- **Subscription entitlements** (`entitlements.service.ts`): photo, active-ad and renew limits
  enforced on create/update/publish with `PLAN_LIMIT_*` 403s. A lapsed plan restricts ads instead
  of deleting them (new `restricted` listing status, migration `0037`), with a 10-minute
  reconciliation sweep. `GET /subscriptions/entitlements`.
- **Subscription purchases + KHQR checkout** (migration `0035`), Manage Ads, and plan-aware
  subscription screens. Membership is folded into Subscriptions.
- **Per-group subscriptions (Khmer24 model)** (migrations `0038`, `0039`): one current
  subscription per (user, group); admin-ticked group scope
  (`PUT /admin/subscriptions/categories/:id/scope`); admin-configured free plan with per-category
  ad caps (`GET/PUT /admin/subscriptions/free-plan`); seed `db:seed:subscriptions`.
- **`PaymentReconciler`**: a 15-second Postgres sweep that activates settled-but-pending
  purchases, reconciles Bakong attempts, accepts late payments within 24 h, and expires
  webhook-only attempts. Runs once at boot.
- **Push notifications over the shared WebSocket** (`RealtimeNotificationChannel`); checkout
  settles on push instead of status polling.
- **ABA PayWay**: webhook-only settlement with a checkout `lifetime`
  (`ABA_PAYWAY_LIFETIME_MINUTES`); on a phone, checkout opens ABA Mobile via deeplink.
- Data-driven subscription filters in the admin.
- Together these deliver the goal of `tasks/plan-tenant-subscriptions.md`: self-serve paid plans
  through the payment module, with enforced limits and admin comp grants. They use a per-user
  model instead of the plan's tenant layer, which was dropped. The plan's order expiry was not
  built.

### Changed

- Upgrade checkout charges the target term prorated to the remaining time, minus unused-value
  credit. Purchases are final (no refunds).
- The ABA webhook moved into `PaymentModule` at `POST /api/v1/payments/webhooks/aba-payway`.
  The old `/api/v1/webhooks/aba-payway` path stays as an alias. **Set `ABA_PAYWAY_WEBHOOK_URL` in
  every environment.**
- Premium account pages follow Khmer24's layout. Web fonts are self-hosted.
- `payment_transactions.tenant_id` dropped (migration `0036`).

### Fixed

- ABA webhooks were all settled `ignored_unconfirmed`: `reconcile()` read `status` under `data`
  when the live API returns it as a sibling.
- The Bakong poll checked expiry before asking the provider, so a payment made at the deadline was
  lost.
- **Graceful shutdown** (`d465bdf`, 2026-10-17): `app.enableShutdownHooks()`. SIGTERM, which
  happens on every Vercel scale-down and redeploy, used to kill the process without running
  lifecycle hooks, so BullMQ workers never closed, Redis pub/sub connections never quit and the
  outbox shutdown grace never ran.
- Long-lived WebSocket sessions held stale state. Completed BullMQ jobs are now removed, and queue
  config is centralised.

## 2026-10-02 → 2026-10-06 — Social features, profiles, deployment

### Added

- **Likes & saves** (`src/reactions/`, migration `0034_acoustic_chat`): idempotent toggles,
  `/users/me/likes|saves|reactions`, and real `/me/likes` + `/me/saved` panels.
- **Follow / unfollow** (migration `0033_add_user_follows`): public profile by username,
  followers/following lists, and `follow.created` notifications. Followers and following swap in
  place on a profile.
- **A seller's post history on the public profile**, with a category strip modelled on the
  homepage tiles.
- **Expo mobile app** (`apps/mobile`).
- **Deployment**: backend Dockerfile, Vercel deploy, a CI deploy workflow with smoke tests, and a
  backoffice subdomain.
- super_admin docs (`docs/super-admin-*.md`).

### Changed

- Account menu items link to their pages. The card "…" menu rows are aligned, and View Profile
  goes to the real seller.
- The grid card heart is red, the list heart is bottom-aligned, and price rows line up across a
  row.
- The "Your Ad" badge was removed from the detail seller card.

### Fixed

- The seller card invented a handle from the contact name, so every profile link 404'd. It now
  shows the seller's actual profile.
- Chat no longer gets stuck on "Decrypting…", and the page reloads when E2E becomes unavailable.
- The backend Jest version skew is fixed workspace-wide (the suite is green on the plain command).

## 2026-09-27 → 2026-09-30 — Full post-form catalogue, search, chat E2E v2

### Added

- **The real post form covers the whole catalogue (146/146 subcategories)**: Services, Fashion &
  Beauty, Furniture & Decor, Books/Sports/Hobbies, Pets and Foods all opted in.
- **Search**: the `/search?q=` page, header search bar, tokenised title + description matching
  with trigram indexes (migration `0031_listing_search`), `effective_price` (price after
  discount) filters, sorts including Best match, a typo fallback, date-posted and delivery
  filters, per-category facet counts, and a sort-aware keyset cursor. The filter bar now drives the
  feed on every page (it was UI-only before), and All Ads uses the real feed.
- **`/settings` made real**: profile, password, username and phone change via OTP, delete account
  with a 90-day purge (`AccountPurgeService`).
- **Designed storefront 404 page.**
- **Chat E2E v2** (`603aa33`, 2026-09-29, per `tasks/plan-e2e-multi-device.md`; Phases 0–2 and
  4/5 done):
  - multi-device (migration `0027`);
  - encrypted history backup with a passcode or device approval (`0028`, `0029`);
  - WebSocket ack/error frames and live read receipts.

  The plan's Phase 3 cutover is still open: rejecting v1 sends, and a real devices page.

- **Encrypted chat attachments** (migration `0030`; `e222daa`/`28e1d37`/`72d5102`, 2026-09-29,
  per `docs/e2e-attachments.md`, P1–P4): a private `chat-files` bucket, AES-256-GCM per
  file, 5-minute signed URLs, an hourly cleanup job, a download button, and a resizable chat
  sidebar.
- **Outbox retention sweep** (`OUTBOX_RETENTION_DAYS` was parsed but never read).
- Ledger amount rules plus a DB `CHECK (amount > 0)` (migration `0032`).
- A Job Type grid on the Jobs category page.

### Fixed

- E2E chat could not decrypt after an identity rotation (stale one-time prekeys).
- The chat composer deleted its own image draft, so images could not be sent.
- Duplicate message keys when the WebSocket echo arrived before the send response.
- "Upgrade Account" pointed at a `/membership` route that never existed.
- Search: date-posted hid listings without `published_at`; expired ads now leave the feed.
- The Show More bars are equal on the left and right.

## 2026-09-18 → 2026-09-24 — Post form families, notifications, chat

### Added

- **Real post form for Phones & Tablets, Computers & Accessories, Electronics & Appliances, Home &
  Land and Jobs.** New blocks: storage/accessory/network, the computers spec cluster,
  bedroom/bathroom/facing/size, and jobType/experience/company. Labels, photo max and Type options
  are read from each subcategory's `field_schema`.
- **Models scoped to subcategories** (`model_subcategory_links`, migrations `0019`, `0020`); a
  slug-collision guard in the model seed.
- **Attribute-grid filters**: `GET /listings` gained `attrKey` + `attrValue`, so clicking a Type,
  Accessory or other tile filters the feed (it used to return nothing).
- **In-app notifications** (migration `0024`).
- **Chat E2E v1**: the key schema and key-management endpoints landed first (2026-09-19,
  `cb0bc4a`/`4d28133`, per `tasks/plan-e2e-phase1-2.md`; migration `0021`). Then a separate
  Ed25519 signing key (`0022`) and X3DH + Double Ratchet over `@noble/curves` (2026-09-21,
  `64c1414`, per `docs/e2e-encryption.md`).
- **Chat production hardening**, delivered on a different path from `tasks/plan.md`:
  - cross-instance realtime push over Redis pub/sub;
  - WebSocket auth and rate-limit parity, and user-keyed throttling;
  - `clientMessageId` dedupe (`0023`);
  - WebSocket tickets, and a heartbeat that records client pongs (`c33fb24`);
  - in-process send-latency metrics at `GET /admin/chat-metrics` (`b9222f9`).
- **Chat UX**: attached-ad cards, draft image management, grouped images (`0026`) and per-side
  conversation delete (`0025`).
- Listings without a price read "Negotiable" instead of `$0`.

### Changed

- The category name is "Phones & Tablets" (it was singular, which broke its i18n lookup).
- A job's company sits on the seller card, not the specs grid. The seller card hides rows with no
  data.
- The icon-vs-text tile design is declared per attribute set instead of sniffed from the rows.

### Fixed

- Description, Location and Address were starred but not enforced, so a listing could publish
  with no location and be invisible to location search.
- Plain Galaxy S21–S25 models were dropped by a `+` slug collision.

## 2026-09-08 → 2026-09-17 — Payments, geography, post form

### Added

- **Payment module** (Effect use-cases, double-entry ledger, `payment` Postgres schema via
  migrations `0014`, `0015`): ABA PayWay and Bakong providers, outbox-driven queue processing,
  and `payment.succeeded` announced on settlement. Fails closed when a provider is unconfigured.
- **Transactional outbox** (`src/outbox/`, migration `0013`).
- Chat tables moved to a `chat` Postgres schema (migration `0016`).
- **Cambodian geography**: 25 provinces, 208 districts and 1,652 communes with Khmer names
  (migrations `0017`, `0018` — geo FKs are `ON DELETE RESTRICT`), and the three-level Location
  picker on the post form.
- **Location map picker** on Leaflet + OpenStreetMap (no Google key), with the pin re-rendered
  on the listing detail.
- **Schema-gated `ListingPostForm`** for all 10 Cars & Vehicles subcategories, plus a cars form
  redesign and real categories in post step 1.
- `DbImage`: only Supabase Storage objects render as images; anything else shows the "no image"
  state.

### Changed

- `vehicletypes` is retired in favour of `bodytypes`. Unticking an attribute in the admin is
  authoritative (`forSub` managed-set rule). Colours are scoped to the subcategories that
  declare them.
- An applied attribute set steps aside, a pick scrolls to the top, and Back walks the drill-down.
- Searchable-picker scrolling: whole rows, a visible scrollbar, and no page scroll-through.

## 2026-08-17 → 2026-09-05 — Storefront goes real

### Added

- **Phone OTP registration and login**: OTP verify page, Cambodia-local phone input,
  phone + password → OTP login, password/names/username set at registration, and `/me` as the
  post-login landing page.
- **Backend-driven storefront**: homepage Browse By Category, category and subcategory pages,
  live brand/model/body-type grids (91 car brands, 31 motorcycle brands), real listing feeds for
  every category, real listing detail with a specs grid and carrier icons, and the unified sticky
  filter bar with grid/list toggle.
- **Ad creation**: `POST /listings` + publish, photo uploads through signed URLs, and a demo
  listings seed.
- Split admin (`/wanderer/*`) and user sessions with separate httpOnly cookies.

### Fixed

- `db:seed` wiped category icons and polluted them with placeholders.

## 2026-06-19 → 2026-08-16 — Foundation

### Added

- Turborepo + pnpm monorepo scaffold.
- **NestJS backend**: Drizzle ORM + Supabase, JWT access/refresh auth, `@Public()`, global
  response envelope and exception filter, idempotency middleware, categories with translations,
  users and phones, listings, brands, files, and the admin API.
- **Chat**: 1:1 conversations, inbox, messages and read receipts over REST.
- **Admin dashboard** (Next.js, later moved from `apps/admin` to `apps/web`): stats, users,
  categories, subcategories, brands, models, attributes, subscription config and reports.
- **`super_admin` role** (2026-08-15, `f008db6`, migration `0012_blushing_sentinel`). It
  satisfies every admin guard; only super_admin may assign staff roles, and the Team page is
  super_admin-only (server redirect + hidden sidebar link).
