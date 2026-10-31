# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Approach for Agents

You are a pragmatic senior engineer. Your job is to help design and build a long-term maintainable backend API.

Non-negotiable rules:

1. Prefer modular monolith with strict module boundaries
2. Evolutionary design — extract services only when there is a clear need
3. Strong typing + OpenAPI contract-first
4. PostgreSQL as primary database
5. Every suggestion must include trade-offs and a path to evolve later
6. Never introduce complexity (Kafka, microservices, CQRS, etc.) unless explicitly requested

For a design/architecture question (not a direct code-edit request), respond with:

- Reasoning (max 5 bullets)
- Concrete recommendation
- Risks
- What to verify next

## Monorepo layout

pnpm + Turborepo. Packages are scoped with `pnpm --filter <name>`.

| Path                          | Name                      | Stack                                |
| ----------------------------- | ------------------------- | ------------------------------------ |
| `apps/backend/`               | `backend`                 | NestJS 11, Drizzle ORM, Supabase     |
| `apps/web/`                   | `web`                     | Next.js 16                           |
| `apps/mobile/`                | `phsarkhmer`                | Expo SDK 54, expo-router, NativeWind |
| `packages/ui/`                | `@repo/ui`                | Shared React components              |
| `packages/eslint-config/`     | `@repo/eslint-config`     | Shared ESLint config                 |
| `packages/typescript-config/` | `@repo/typescript-config` | Shared tsconfigs                     |

## Repository docs

- **`ARCHITECTURE.md`** (root, merged from prod 2026-10-24) — the current system map and backend/web architecture details; verify implementation-specific claims against code. **`docs/architecture.md`** is the older 2026-07-31 map — its §8 "engineering constraints" and §7 "technical debt" are still useful, but its counts have drifted (migrations are now `0000`–`0040` from prod plus v1's renumbered migrations) — verify numbers before repeating them.
- **`AGENTS.md`** (root) — the **engineering rules** and the authority for the Module README convention: feature modules, no speculative abstractions, Postgres as source of truth, thin controllers, smallest-possible diffs.
- **`CHANGELOG.md`** (root) — shipped changes by date (Keep a Changelog), with an `Unreleased` section for in-flight work; **`tasks/todo.md`** — the running ship log (append a dated entry per ship); `tasks/waiting-for-implements-laters.md` — parked work; **`docs/post-form-layout.md`** — the post form's layout, step by step (moved from `tasks/redesign.md`).
- **Module READMEs** (`src/payment/README.md`, `src/chat/README.md`, `src/tenant/README.md`, `src/admin/subscriptions/README.md`, provider dirs) are the accurate, deep docs.
- **Everything else is boilerplate or history**: root + `apps/web` READMEs are create-turbo output (web still has conflict markers), `apps/mobile/README.md` is create-expo-app output — read them for nothing.

## Prerequisites

- **Node.js** ≥ 18, **pnpm** 9.0.0 (enforced by `packageManager` in root `package.json`)
- First clone: `pnpm install`

## Commands

### Root (runs across all packages via Turbo)

```bash
pnpm install       # first-time setup
pnpm build          # build all packages
pnpm dev            # dev all packages in parallel
pnpm lint           # lint all packages
pnpm check-types    # type-check packages that define it (currently @repo/ui only)
pnpm format         # prettier all .ts/.tsx/.md (CLAUDE.md is in .prettierignore on purpose — see Tooling quirks)
pnpm format:check   # CI's format gate (prettier --check; writes nothing)
```

### Backend only

```bash
pnpm --filter backend build          # nest build → dist/src/
pnpm --filter backend start:dev      # watch mode
pnpm --filter backend lint           # eslint --fix
pnpm --filter backend test           # jest (unit, rootDir=src, *.spec.ts)
pnpm --filter backend test:watch     # jest watch
pnpm --filter backend test:e2e       # jest --config test/jest-e2e.json
pnpm --filter backend test:cov       # jest --coverage

# Single test file (Jest 30: flag is plural; singular --testPathPattern errors out)
pnpm --filter backend test -- --testPathPatterns=jwt-auth.guard

# Single test by name
pnpm --filter backend test -- --testNamePattern="throws Unauthorized"
```

### Database (backend)

```bash
pnpm --filter backend db:generate    # drizzle-kit generate (creates migration files)
pnpm --filter backend db:migrate     # apply migrations
pnpm --filter backend db:push        # push schema directly (dev only)
pnpm --filter backend db:studio      # Drizzle Studio UI
pnpm --filter backend db:seed        # ts-node src/db/seed.ts (idempotent seed)
```

### Web (Next.js)

```bash
pnpm --filter web dev          # Next.js dev on port 3001
pnpm --filter web build        # next build (includes full type-checking)
pnpm --filter web lint         # eslint
```

`web` is a full user-facing marketplace + admin dashboard (Next.js 16 App Router + `next-intl`). It is **standalone**: no `@repo/*` deps, nothing extends `@repo/typescript-config`, its flat `eslint.config.js` uses `eslint-config-next` directly. No `check-types` script (`next build` is the type gate) and no test framework. The DOM is client-rendered — raw HTML/`curl` greps see only the flight payload — so verification means driving a real browser; the worked recipe is headless Chromium + raw CDP: `chromium --headless=new --no-sandbox --disable-gpu --blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=2,availableHoverTypes=2 --remote-debugging-port=9333 --user-data-dir=/tmp/<fresh-profile>` (the blink-settings force `(hover: hover)` — plain headless resolves `hover: none`, silently killing every `hover:*` utility), plus `Emulation.setDeviceMetricsOverride` (default viewport 800×600 clips pages; the login form's focus-scroll survives client-side nav — `window.scrollTo(0,0)` first) and `Emulation.setEmulatedMedia {prefers-color-scheme: light}`; wait ~10 s after navigation for hydration. Radix dropdown **triggers** open on pointerdown (dispatch `Input.dispatchMouseEvent` mousePressed, hold ~350 ms, mouseReleased — a synthetic `click()` does nothing), **menu items** on plain `click()`; the navbar avatar trigger is `[data-slot="dropdown-menu-trigger"].ml-2`; fill React inputs with the native setter + `new Event('input', {bubbles:true})`. Kill chromium with `pgrep -f "[r]emote-debugging-port=9333" | xargs -r kill -9` (bracket trick avoids self-match).

### Mobile (Expo)

```bash
pnpm --filter phsarkhmer start    # Expo dev server (the package is named `phsarkhmer`, not `mobile`)
pnpm --filter phsarkhmer android  # expo run:android
pnpm --filter phsarkhmer ios      # expo run:ios
pnpm --filter phsarkhmer web      # expo start --web
pnpm --filter phsarkhmer lint     # expo lint — the only gate it has
```

Root `pnpm dev` does **not** start the app (no `dev` script; Turbo skips it). No `test`, no `check-types`: run the compiler by hand with `pnpm --filter phsarkhmer exec tsc --noEmit` — CI lints the app but never type-checks it.

### Shared packages

```bash
pnpm --filter @repo/ui lint               # lint shared UI components
pnpm --filter @repo/ui check-types        # type-check @repo/ui
pnpm --filter @repo/eslint-config lint    # lint eslint config package
```

**`@repo/ui`** exports `./src/*.tsx` — import as `@repo/ui/button`, `@repo/ui/card`, `@repo/ui/code`. Write new shared components here, not in apps.

**`@repo/typescript-config`** — three presets: `base.json`, `nextjs.json`, `react-library.json`. **`@repo/eslint-config`** — three presets: `base.js`, `next.js`, `react-internal.js`.

## Backend architecture

### Request lifecycle

```
Request
  → IdempotencyMiddleware  (POST/PATCH/PUT only; middleware runs before guards)
  → JwtAuthGuard          (global APP_GUARD #1)  ← skipped if @Public()
  → UserAwareThrottlerGuard (global APP_GUARD #2) — keys on req.user.id when set, else IP
  → ValidationPipe (whitelist + transform)
  → Handler
  → ResponseInterceptor  → { success, data, meta? }
  → GlobalExceptionFilter  (on throw)
```

JwtAuthGuard runs first specifically so the throttler can see `req.user` — one busy office/campus no longer shares a single IP-keyed bucket. `UserAwareThrottlerGuard` falls back to IP for anonymous/public requests.

### URL structure

Global prefix `api`, excluded for `GET /` and `GET /health`. URI versioning, `defaultVersion: '1'`.

- `GET /` → `Hello World!` (no auth, no prefix) — note the app serves the root at `/v1` in practice
- `GET /health` (no auth, VERSION_NEUTRAL)
- Everything else: `/api/v1/<resource>/…`

### Auth model

- `@Public()` on a handler/controller bypasses `JwtAuthGuard` entirely; otherwise a valid `Bearer` token is required.
- JWT payload is `{ sub, role, sid? }` (`'user' | 'admin' | 'super_admin'`). `sid` is the `user_login_devices.session_id` revocation epoch; `JwtStrategy.validate` checks the DB (and, when `sid` is present, joins the active device row), rejects soft-deleted users (`deletedAt` set), and sets `req.user` as `RequestUser { id, role, sessionId? }`. Tokens without `sid` (legacy, admin, social/Telegram) are grandfathered. **Roles are literal, not hierarchical (2026-10-26):** `RolesGuard` does `requiredRoles.includes(role)`, so `@Roles('admin')` now *excludes* a `super_admin`. The two staff tiers are separate mandates — `super_admin` is governance-only (stats, reports, team, feedback, advertisements) while catalogue/subcategory/brand/model CRUD, listings, attributes, subscription config, user-subscriptions and payments are `@Roles('admin')` — and a route both may use names both roles explicitly. On top of the tier split, `assertCanManageUser` still restricts staff-account edits to `super_admin`, and the Team page is super_admin-only.
- Use `@CurrentUser() user: RequestUser`. Dual tokens: `accessToken` (15 min) + `refreshToken` (30 d, separate `JWT_REFRESH_SECRET`).
- Soft-delete is enforced at all three entry points: `loginWithPassword`, `refresh`, `JwtStrategy.validate`.

### Auth flow — phone registration & login (OTP + password)

```
POST /api/v1/auth/register    { phone }                   → sends OTP via Supabase (or dev bypass)
POST /api/v1/auth/otp/request { phone }                   → re-sends OTP (public; E.164 RequestOtpDto)
POST /api/v1/auth/otp/login   { phone, password }         → login-mode: validates credentials, THEN sends OTP (bad creds → 401, no SMS)
POST /api/v1/auth/otp/verify  { phone, token, password, firstName?, lastName? } → verifies OTP; creates the account (register) or logs the user in
```

`verifyPhoneOtp` is the single creation/login chokepoint:

- **User exists** — the submitted `password` must match (`bcrypt.compare`); mismatch → 401 **before** any OTP is consumed. The conflict path can never overwrite credentials: payload extras land only in the INSERT `.values()`; `onConflictDoUpdate.set` stays `{updatedAt}` (locked by a unit test). A replayed body with a fresh password/names/username is ignored.
- **User absent or a legacy bare account** (null `passwordHash`) — verify **completes the account in place**: bcrypt (10 rounds), `firstName`/`lastName`, username via `generateUniqueUsername(buildUsernameBase(first,last))` → `sokdara`, `sokdara2`, …. A phone-digit fallback is deliberately avoided so the nicer name-based handle stays free.
- Verify **without** `password` is a 400 — there is no passwordless login path (the public resend can never be a backdoor).

`mirrorSupabaseUser` upserts users without a Supabase-specific ID: phone auth conflicts on `primaryPhone`, social on `email`; both insert `user_auth_providers` + `user_phones` (isPrimary) when a phone exists. Soft-deleted phones don't conflict (partial index `WHERE deleted_at IS NULL`).

### Devices & session revocation

`user_login_devices` (`db/schema/login-devices.schema.ts`, migration `0041`) is both the device registry behind `security.new_login` and the session-revocation anchor. Login clients send `x-device-id` / `x-device-name` plus a URL-encoded `x-device-info` JSON header (`{ type, clientVersion, userAgent }`; the native app sends `{ type:'app', model, osName, osVersion, clientVersion }`). The backend parses the browser UA into browser/OS/model fields. `session_id` is the revocation epoch: login reuses it, revoking rotates it, and tokens carry it as `sid`. Endpoints (JWT): `GET /auth/devices` (active rows, `isCurrent`, `lastSeenAt` heartbeat), `DELETE /auth/devices/:id`, `POST /auth/devices/revoke-others`, `POST /auth/logout`. Refresh binds a legacy (no-`sid`) token via `x-device-id` and rejects a revoked row. Web `lib/device.ts` mirrors the localStorage id into the non-httpOnly `phsarkhmer_device_id` cookie; the settings/devices page is real.

### Database access

`DbModule` is `@Global()` — never import it in feature modules. Inject `@Inject(DRIZZLE) private readonly db: DbClient`; for raw SQL use `@Inject(PG_CLIENT) private readonly sql: postgres.Sql`. Drizzle uses `casing: 'snake_case'` (write camelCase column names; the driver maps). Schema files live in `src/db/schema/`, re-exported from `index.ts`.

### Supabase

`SupabaseModule` is `@Global()` — inject `SupabaseService` directly. It exposes one admin client (service-role key) plus a helper for user-scoped clients; OTP, social OAuth, token validation and storage go through it. `signInWithOtp`/`verifyOtp` support a dev bypass via `DEV_OTP_TOKEN` — keep it ≤ 6 digits (the web OTP input has 6 single-digit boxes; currently `000000` in `apps/backend/.env`; changing it needs a backend restart). In dev the Supabase-side user id is the literal `'dev'`; repeat-login identity comes from the `primaryPhone` upsert.

**Social login (2026-10-31):** Google/Facebook OAuth is wired end to end on the web (`LoginForm` + `AdminLoginForm`). `GET /auth/social/:provider/url?redirectTo=<web callback>` is public; `redirectTo` must be an absolute http(s) URL whose origin is in `FRONTEND_ORIGINS` (dev falls back to loopback only, production fails closed). `POST /auth/social/callback` takes `{provider, accessToken, mode?}`; `mode: 'admin'` signs in an existing `admin`/`super_admin` by provider link or lower-cased email and never creates a user, answering a uniform 401 otherwise. Social identities link on `user_auth_providers.providerAccountId` (the Supabase user id) before email; `email_confirmed_at` is required and the token's identity must match the claimed provider (closes audit M1). The web callback routes (`/[locale]/auth/callback/[provider]`, `/wanderer/auth/callback/[provider]`) are client components that read the implicit-flow `#access_token`, strip the fragment (immediately and again after hydration — Next restores it once), and exchange it in a server action; an httpOnly `social_oauth_pending` cookie binds the callback to the starting browser. Both login forms open the provider in an `about:blank` popup and disable the Login/Telegram/Apple/Google/Facebook buttons until it closes (the fields stay editable; cancelling re-enables the buttons); the callback completes in the opener and closes the popup, falling back to a full-page redirect when popups are blocked. Setup: `docs/social-oauth-setup.md`.

**Linked accounts (2026-11-01):** `/settings` renders Facebook/Google/Telegram from `GET /users/me?includeAuthProviders=1` (additive and opt-in, so the `(user)` layout pays no extra query) — `Add` or `Linked` plus a chevron, shared by the hub and rail via `LinkedAccountsRows`. `POST /auth/social/link` (JWT) attaches a Google/Facebook identity to the signed-in account (409 `PROVIDER_ACCOUNT_ALREADY_LINKED` / `PROVIDER_ALREADY_LINKED`; never mints tokens), and `DELETE /auth/social/:provider` (JWT, google|facebook|telegram) refuses `LAST_LOGIN_METHOD` when no phone, username + password or other provider remains. The link flow stores `social_link_pending = provider:nonce` and echoes the nonce in the `/auth/link/{provider}/{nonce}` path, so a callback URL is single-use and bound to the starting browser. Telegram is display/remove only until its Login Widget ships; a later social login with the same email re-links an unlinked provider (`resolveSocialUser`).

### Response envelope

`ResponseInterceptor` wraps non-string returns: `{ success: true, data, meta? }`. Strings pass through unwrapped (`GET /` → `Hello World!`). Errors from `GlobalExceptionFilter`: `{ success: false, error: { code, message, details? } }`.

### Idempotency

`IdempotencyMiddleware` (POST/PATCH/PUT) hashes the body (SHA-256) and stores key+method+path+user in `idempotency_keys` (unique with `NULLS NOT DISTINCT` so anonymous requests dedupe too). It runs before guards, so it verifies the `Bearer` token itself (invalid/absent → anonymous scope). First-request detection is `INSERT … ON CONFLICT DO NOTHING … RETURNING`: returned row = proceed; conflict = replay (completed) / 409 (processing < 30 s) / 422 (processing, different body hash) / reclaim (failed rows flip back to processing). Known gap: hash mismatch on completed rows returns the cached response instead of 422.

### Categories i18n

Four tables, not two: `categories`/`subcategories` (structure; subcategories carry `field_schema` JSONB) + `category_translations`/`subcategory_translations` (`(id, locale, name, description)`). Locales `'en' | 'km' | 'zh'` (`localeEnum`), resolved from `Accept-Language` via `resolveLocale()` in `src/categories/locale.util.ts`. `CategoriesService` runs **two aliased LEFT JOINs** per query (requested locale + `'en'`) then COALESCEs in JS: `reqName ?? enName ?? cat.slug`.

**`field_schema` JSONB** = `FieldDef[]` describing the listing form fields (type `text | number | select | boolean | price | discount | photos | location | contact`; key, label (en), required, options?, max?). The web form now **consumes it at runtime** (schema-gated blocks). Conventions when seeding from a `spec-detail-*.md`:

- Reuse the module-level `conditionField` const (only when the form has a Condition field); photos inline as `{ key: 'photos', type: 'photos', max: n }` — **max is per-category, read each spec's own `Photo (0/N)` line, never generalize** (Jobs 1, Services 8, most 8).
- Contact trio: `contactName` / `contactPhones` (max 3) / `contactEmail`, all `type: 'contact'`. Fold Address + maps into a `location` field plus a `text` `address` field. Key any "Type" picker `type` with `type: 'select'` + options. `number` for free numerics; `select` only for enumerable ones (`storage`, `year`).
- Size unit lives on the display: the form takes a bare number, the detail grid appends `m²` via `VALUE_SUFFIX` (JSONB stores `"220"`, detail reads `220m²`).
- All subcategories of a family sharing one form (Jobs, Services, Pets, Foods) get one identical schema array.
- **`commonListingFields`** (photos/title/price/discount/description/location/address/deliveryFree/contact trio) is written **INLINE** field-for-field, never referenced as the whole `fieldSchema` value; only ever spread for the photos field. Collapsing that duplication is a tracked follow-up.

Seed (`src/db/seed.ts`) runs geography → categories → brands → models → attributes → admin → reports → demo listings; all idempotent, models/attributes insert-only. `listings.seed.ts` upserts 22 curated demo listings and deletes known junk titles (`JUNK_TITLES`) so E2E debris never survives a seed — but see Known gaps for the debris it misses.

### Users schema

`users` relates to six satellite tables: `user_phones` (unique phone, `isPrimary`, owned), `user_auth_providers` (one row per user+provider: telegram/phone/google/facebook), `user_blocks` (directional; unique pair; both FKs cascade), and the geo lookups `provinces`/`districts`/`communes` (fully seeded; see geography below).

Key columns:

- `username / primaryPhone / email` — unique via **partial indexes** (`WHERE deleted_at IS NULL`), so soft-deleted users release identifiers. Upserts targeting them pass `targetWhere: isNull(users.deletedAt)`; lookups filter the same. `generateUniqueUsername(db, base)` (`src/users/username.util.ts`) suffixes `base, base2…` (skips 1), caps at 50 chars, and probes ALL rows including soft-deleted (stricter than the index). Wired into Telegram login, `updateProfile` lazy backfill, phone-OTP registration. Check-then-insert → a 23505 race is possible (Known gaps).
- `provinceId / districtId / communeId` — nullable FKs, **`ON DELETE RESTRICT`** (a geography re-seed must never silently clear a user's location).
- `deletedAt` / `status='deleted'` — soft delete. `preferredLanguage default 'en'` also drives the admin UI locale (the `/wanderer/*` surface reads an `admin_locale` cookie seeded at login; the in-dashboard `LocaleSwitcher` writes back via `PATCH /users/me`). DTO allowlist: `en, km`.

`user_phones` enforces at most one `isPrimary` per user (partial unique index); `phone` itself stays globally unique (not freed by soft-delete).

**Phone endpoints** (JWT): `POST /users/me/phones`, `DELETE /users/me/phones/:phoneId`, `PATCH /users/me/phones/:phoneId/primary` — ownership via `and(eq(id), eq(userId))`. **Block endpoints** (JWT): `GET/POST /users/me/blocks`, `DELETE /users/me/blocks/:userId` — blocking is idempotent; a block either way makes chat sends 403.

**Follow endpoints (2026-09-28):** `GET /users/by-username/:username` (**`@Public()`** — an explicit `PublicProfile` allow-list: identity, createdAt, isVerified, counts; never phone/email/role/moderation state), `GET/POST/DELETE /users/:id/follow`, `GET /users/:id/followers|following` (JWT, offset-paginated, each row carrying viewer-relative `isFollowing`), `GET /users/me/follow-counts`. Backed by **`user_follows`** (mirrors `user_blocks`: unique pair + reverse index + `follower_id <> following_id` CHECK, both FKs `CASCADE` so `AccountPurgeService` keeps working). Follow/unfollow are both idempotent (`onConflictDoNothing`; DELETE deliberately never 404s — the toggle's end state is the contract). Following is 403 when either side blocked the other; a genuinely new edge writes one `follow.created` notification, gated by the `returning()` row so replays can't double-notify. The lists require JWT on purpose (that's what buys `isFollowing` without N+1). Not transactional with the notification — see Known gaps.

**Activity tracking:** `LastSeenInterceptor` (global) calls `ActivityService.touch(userId)` fire-and-forget with a 5-minute in-memory throttle.

**Migration status:** `drizzle/migrations/` holds `0000`–`0048`. Landmarks: `0000` core schema+enums, `0001`–`0002` users, `0003` listing_photos, `0004` partial uniques + CHECKs, `0005`–`0006` chat tables + `timestamp(3)`, `0007` attribute_options, `0008` subscriptions, `0009` reports, `0012` `super_admin`, `0013` outbox_events, `0014`–`0015` payment tables → `payment` schema, `0016` chat tables → `chat` schema, `0017`–`0018` geo (`name_km`; inbound geo FKs become RESTRICT), `0019`–`0020` model↔subcategory links + a slug data-fix, `0021`–`0026` chat E2E keys/multi-device prep, `0027`–`0030` E2E devices/envelopes + backups + `chat.attachments`, `0031_listing_search` (pg_trgm + generated `STORED` `effective_price`), `0032_ledger_entries_amount_positive`, `0033_add_user_follows`, `0034_acoustic_chat` (`listing_likes`/`listing_saves`). From **origin/prod** (already applied on the deployed DB): `0035_sudden_shinobi_shaw` (`subscription_purchases`, `user_subscriptions.superseded_at`), `0036_messy_millenium_guard` (drop `payment_transactions.tenant_id`), `0037_burly_taskmaster` (`listings.renew_count`), `0038_thankful_skullbuster` (one-current subscription index), `0039_fuzzy_firelord` (free-plan tables + category-scoped subscriptions), `0040_moderation_feedback` (`feedback`, `listings.moderated_at`/`moderated_by_id`/`moderation_reason`, pending-report unique indexes). **`0041_flimsy_sentinel`** is v1's consolidated feature migration, generated from the merged schema: `banned_phones`, the 9 resume tables, `job_applications`, `listing_events`, `users.date_of_birth` + discoverability flags, `user_login_devices` (with device metadata + `session_id`/`revoked_at`), `listing_reports.image_paths`, `attribute_options.name_km`. After prod's `0040`: `0042_omniscient_cloak` (advertisements/billing addresses), `0043_sleepy_forge`, `0044_rapid_skaar`, `0045_collapse_subscription_plans` (drop `subscription_plans`, packages keyed by group+tier, terms normalized to 3/6/12 months), `0046_noisy_wolverine` (`listing_renewals`: one row per renewal spent, read by the 30-day renewal window), `0047_luxuriant_earthquake` (`product_spec_family` enum + `product_specs.family`, derived from the model's family subcategory with a phone fallback), `0048_lucky_harrier` (`product_specs.image`). **Renumbering history:** chat's `0017`–`0022` became `0021`–`0026` on merge; `feat/chat`'s `0023`–`0026` became `0027`–`0030`; v1's follow/likes pair went `0027`/`0028` → `0031`/`0032`; on the **2026-10-24 prod merge** v1's `0035`–`0044` collided with prod's own `0035`–`0040`, so they were consolidated into `0041_flimsy_sentinel` (`drizzle-kit generate` over the merged schema; the original files are in `git show 8ad153a:apps/backend/drizzle/migrations/`). Expect to renumber whenever two branches both add migrations. **Gotcha:** `db:migrate` compares only each file's journal `when` against the newest `created_at` in `drizzle.__drizzle_migrations` — an unapplied file stamped older than that watermark is silently skipped. If a migrate fails on a missing relation, check that table first.

**Cambodian geography seed (2026-09-12):** 25 provinces / 208 districts / 1,652 communes with `name`, `name_km`, `slug`, loaded from `seeds/data/cambodia-geography.json` (a checked-in snapshot of the NCDD-derived gazetteer, MIT; villages deliberately omitted). Each level upserts on its natural key, so re-runs are no-ops; seven legacy capital rows map through explicit aliases. Requires migrations 0017+0018 first. **`apps/web/lib/location.ts` is NOT a source** (2019-vintage, ~21 % complete, different romanisation — deleted in the 2026-10-30 mock-data cleanup).

### Locations API

`LocationsModule` (`src/locations/`) — three public read-only routes: `GET /locations/provinces`, `/provinces/:slug/districts`, `/provinces/:pSlug/districts/:dSlug/communes`. All `@Public()`. Province list is `[]` when empty, but the two nested routes **throw 404** on an unknown parent slug. Rows are `{id, name, nameKm, slug}` (+parent id at level 2; `nameKm` is the Khmer gazetteer name, returned additively since 2026-10-21). The post form's three-level cascade is driven off them, and the web shows `nameKm` on `/km`.

### Brands

`BrandsModule` (`src/brands/`) — lookup tables for brand/model selects. Routes (all `@Public()`): `GET /brands` (all active, sort_order), `?subcategory=<slug>` (linked brands; `[]` unknown slug), `GET /brands/:id/models` (active models; `[]` if none), `?subcategory=` filters models.

**Models are scoped to subcategories (2026-09-22)** via **`model_subcategory_links`** — a model can span two subcategories (Surface Pro 10: laptops + tablets). The filter rule: with no `subcategory` the whole catalogue returns (admin Models page); with one, the result is **models linked to that subcategory ∪ models with no link at all** — an unclassified model must never empty a picker, while a model linked only elsewhere is excluded. The naive `subcategoryId != this` test would be wrong (it would drop multi-linked models) — `BrandsService.listModels` uses `inArray(linkedToThis) OR notInArray(linkedAnywhere)`.

Seed (`brands.seed.ts`): `MODEL_SEEDS`/`MOTO_MODEL_SEEDS` are grouped by subcategory — that grouping IS the classification, and `seedModels` writes the links in a second pass. Model slugs spell `+` as `-plus`; until 2026-09-22 the trailing-`+` entries claimed the bare slugs and the plain Galaxy S21–S25 were silently dropped by `onConflictDoNothing` — migration `0020` renamed the six affected rows, and `findSlugCollisions` (pure, unit-tested by temporarily seeding a colliding name) now warns when a seeded name doesn't match the name stored at that `(brandId, slug)`. Models are insert-only; admin `PATCH /admin/models/:id` is the only other writer. Assigning a model to a subcategory its brand isn't linked to is refused with a warning (unreachable there). Brand sets: `BRANDS` (67 phone/tablet/watch/computer brands), `CAR_BRANDS` (91, design order, MG first), `MOTO_BRANDS` (31, Honda first; Honda/Suzuki/BMW take `-moto` slugs so each branch keeps its own row/icon/position). Shared slugs (`xiaomi`, `other`) only wire links on later occurrences so they can't clobber the first set's `sortOrder`. `BrandSeed.icon` lands **only on INSERT** — admin-uploaded icons survive re-seeds. Brands return `{id, slug, name, icon, sortOrder}` (`icon`, not `image`; models use `image`); brands never nest models.

### Products — Product Specifications (2026-10-30)

Admin-managed spec pages built on the existing catalogue: one `product_specs` row per `models` row (`model_id` unique, `ON DELETE CASCADE`), holding `family` (enum `product_spec_family`: `car | motorcycle | phone | tablet | smartwatch`), ordered `spec_groups` JSONB (`[{title, rows:[{label,value}]}]`) and `is_published`. The family is pinned at create and immutable. Input mode is per family in `src/products/spec-templates.ts`: **Cars and Motorcycles are freeform** — staff add any group/row (the old editor), so ICE and BEV fields fit without a fixed schema; **Phones, Tablets and Smart Watches are template-driven** — fixed sections/fields returned by `GET /admin/products/template/:family` (`mode: 'template' | 'freeform'`). The template is the single source for templated families. A template field may be `multi` — the stacked reference cells (2G–5G bands, Build, SIM, Internal, both camera `Modules` lists, Sensors, Charging): the editor then allows several rows with the same label, and the public page folds them under one label. The phone/tablet Misc template follows the reference — Colors / Models / SAR / SAR EU, no Price; a stored Price row is preserved as Additional details — and Body carries an explicit `IP rating` field for the reference's unlabelled IP68 note. Each page can carry a staff-uploaded image (the staff-only `product` sign scope); when empty the public page falls back to `models.image`. Product images render **contain-fit, never a square crop**: the admin preview is a wide 256×160 box and the public header a 384×256 panel, because cars are wide and phones are tall. Nothing is scraped and no external link is used. `ProductsModule` (`src/products/`) follows the attributes precedent — public and `/admin/products` controllers in one module; admin routes are `@Roles('admin')`.

```
GET /api/v1/products?q=&limit=&family=           @Public; published specs whose brand AND model are active; optional family filter; token search over brand/model name+slug
GET /api/v1/products/:brandSlug/:modelSlug       @Public; 404 unless published; + family in the detail
GET    /api/v1/admin/products?family=            admin list (optional family filter)
GET    /api/v1/admin/products/template/:family   admin; the family's template + mode (template | freeform)
POST/PATCH/DELETE /api/v1/admin/products/:id     modelId+family immutable; duplicate model 409; missing model 400
```

Create verifies the model is linked to the family's listing subcategory (`cars-for-sale`, `motorcycles-for-sale`, `phones`, `tablets`, `smart-watches`) and rejects a model that is not. For **template** families, stored groups are enforced: on create every group must be a filled subset of a template section (title + labels, unique labels); on update the row's already-stored legacy groups are grandfathered by exact title+label signature, so a pre-template page stays editable; invalid groups are 400 `INVALID_SPEC_SECTION`. **Freeform** families (Cars, Motorcycles) accept any non-empty groups. The web admin lives at `/wanderer/dashboard/product-specifications/{cars|motorcycles|phones|tablets|smart-watches}` (sidebar parent **Product Specifications**, five children); `/wanderer/dashboard/products` redirects to the Cars child.

`listings.product_model_id` (nullable FK → `models`, `SET NULL`) is the ad→page link. Create/update reject an unpublished target (`productModelId must reference a published product spec`) and, when the listing's subcategory belongs to a family, a spec of a different family (`productModelId must reference a spec page from the same family as the listing subcategory`). `GET /listings/:id` embeds `product: { modelId, brandSlug, brandName, modelSlug, modelName } | null` (null when unlinked or unpublished), alongside the stored `productModelId`.

The `productSpec` key (`{ key: 'productSpec', type: 'product', required: true }`, label "Product Specification") is declared by **five** subcategories: `cars-for-sale`, `motorcycles-for-sale`, `phones`, `tablets`, `smart-watches`. `getListingFormConfig` loads up to 200 published products, filtered to the subcategory's family, only when the key is declared; `ListingPostForm` renders a required picker that searches "Brand Model", resolves a **pasted product URL** (`/en/product/<brand>/<model>`, absolute or relative) locally, auto-fills Brand+Model when empty, clears the link when either changes, and sends `productModelId` top-level (never inside `attributes`). Required-ness is form-only, like every other per-form rule. The detail shows "View full specs"; `/product/[brand]/[model]` (RSC, pathname declared in `i18n/routing.ts`) renders the groups plus active ads via the feed's display-name brand/model filters; `/search` adds a "Product specs" section above results when `q` is present. The public page uses a scoped **`product-type`** scale (h1 32/40, h2 22/30, uppercase 14px section headings — the captain's 2026-10-30 exception to the app-wide 20/28 titles) with a 4:3 contain image panel, a Trusted-specs badge, family/fuel chips and one full-width spec card per section, stacked (captain, 2026-10-31).

### Listings

`ListingsModule` (`src/listings/`) — cursor-based public feed + offset-based owner feed.

**Feed (`GET /api/v1/listings`)** — `findFeed()` resolves slugs via a private `resolveQueryFilters`; any unknown slug short-circuits to `{ data: [], meta }` (no error; same in `findMine`). Params: `categorySlug`, `subcategorySlug`, `provinceSlug`, `districtSlug`, `communeSlug`, `q`, `minPrice`, `maxPrice`, `condition`, `yearMin`/`yearMax` (`attributes->>'year'`; non-numeric never match), `engineType`, `sort`, `postedWithin`, `deliveryFree`, `userId` (one seller's active ads — the public profile feed), `includeTotal`, `includeFacets`, `brand`, `bodyType`, `model`, `taxType`, `color`, `transmission`, `attrKey`+`attrValue`, `attrs` (a JSON object of attribute-key→value pairs, AND-ed). `districtSlug` without `provinceSlug` (and `communeSlug` without `districtSlug`) is silently ignored; half an `attrKey`/`attrValue` pair applies nothing, as does malformed or oversized `attrs`. **`brand`/`bodyType`/`model`/`taxType`/`color`/`transmission`/`attrKey` match the display names stored in `attributes` JSONB**; `attrKey` is validated to a plain identifier and **bound as a parameter, never interpolated** (unit tests compile the WHERE and assert `->>$n`).

**Search, sort and facets (2026-10-05):** `q` is a real keyword search — ≤ 5 whitespace tokens, every token must appear in `title` or `description`; an empty first page retries through `word_similarity` trigram matching (tokens of 4+ chars only), a mode pinned in the cursor (`f`) and reported as `meta.fuzzy`. `minPrice`/`maxPrice` bound the **generated `STORED` `effective_price`** column (post-discount), so NULL-price "Negotiable" listings are excluded while a bound is set. `sort` ∈ `newest | price_asc | price_desc | relevance` (relevance ranks by `word_similarity`, falling back to newest without `q`); `postedWithin` ∈ `today | week | month` (ICT); `includeTotal`/`includeFacets` add `meta.total` / per-category (then per-subcategory) counts.

**Trending (`GET /api/v1/listings/trending`, 2026-10-26):** the home page's engagement-ranked strip, surfaced as "Trending" (it replaced the mock Top Ads carousel; `TopPosts`/`HighLightAds` were deleted). `findTrending()` scores **live** listings only (`liveConditions()` — active + not expired, so taken-down/`deleted`/`restricted` ads can never trend) over a rolling `windowDays` (default 7, max 30; `limit` default 10, max 20): weighted `listing_events` (view 1, chat 3, call 3, show_contact 3, apply_job 5 — **impressions excluded**, they measure placement) plus likes/saves at 2 each with the owner's own like/save excluded. Aggregates are derived tables joined to `listings` (`score > 0`), and the tail is filled with the newest live listings so the rail never empties. Single page, no cursor — the score moves as events land, so a cursor over it would skip or repeat rows. A 5-minute per-process cache fronts it; **`listing_events` has no `created_at` index yet**, so add one (or a daily rollup) before the event table grows.

**Ad creation** — `POST /listings` (JWT): `categoryId`/`subcategoryId` as **UUIDs**, inserts `status='draft'`, `attributes` JSONB, `photos: [{url, path, sort}]` (max 8; `path` = the `/files/sign` storage path). `POST /listings/:id/publish` (owner) flips to `active` + `expiresAt = +30d`; the feed only shows `active` — a client flow must create **then** publish. The plan allowance (pool total + scope cap) is checked at **create** as well, so an over-limit post never creates a row; the web has no draft surface and rolls a refused publish back. PATCH swaps `listing_photos` and best-effort cleans up dropped photos after commit.

**Cursor (feed):** sort-aware base64 JSON `{ s, v, id, f? }` (sort; last sort value as TEXT; fuzzy flag) — a cursor from one sort is ignored on another. Sort values round-trip as text (`created_at::text`, `effective_price::text`), never JS Dates (ms truncation would skip boundary rows). Invalid cursors are ignored; the legacy `{createdAt, id}` shape still pages old links.

**Owner feed** (`GET /listings/me/all`): offset pagination + `status` filter. **Expiry is derived, never stored (2026-10-27):** nothing flips `status` when the 30-day window closes, so `findPublicById` reports a lapsed `active` ad as `expired` — its shared link keeps working, with an expired notice and contact disabled — and 404s `draft`/`deleted` ads; `findMine` derives the same status and maps the `active`/`expired` filters to date ranges (Active = live now; Expired = stored-expired ∪ lapsed-active), which is what makes Manage Ads' Expired tab real; the web detail page renders the notice, hides the phone/email/contact actions, and the Expired tab shows a badge. The hourly `ListingExpiryService` sweep notifies the owner (`listing.expiring` when 3 days remain, `listing.expired` once for ads that lapsed in the last 24 h — the lookback is deliberate so a deploy never blasts every historical lapse), and Manage Ads shows an "Expires in N days" chip on Active rows inside that 3-day window.

### Likes & Saved (`src/reactions/`, 2026-10-05)

**`listing_likes` + `listing_saves`** (`db/schema/reactions.schema.ts`, migration `0034_acoustic_chat`) mirror `user_follows` (unique pair, reverse index, CASCADE FKs). No self-check: liking your own listing is allowed.

```
POST|DELETE /api/v1/listings/:listingId/like   → { liked, likeCount }
POST|DELETE /api/v1/listings/:listingId/save   → { saved }
GET  /api/v1/users/me/likes|saves              → paginated listing rows (the feed's shape)
GET  /api/v1/users/me/reactions                → { liked: uuid[], saved: uuid[] }
```

Toggles are idempotent both ways (POST `onConflictDoNothing`; DELETE never 404s — a stale unlike returns `{liked:false}`). The only 404 is a missing listing on the POST side; `findById` serves any status so a control on the detail page is never present-but-refused. List reads filter `status != 'deleted'`; the id-set read is unfiltered. `likeCount` is computed per read and rides the detail response + every toggle response. `ListingsModule` imports `ReactionsModule` (no cycle). **Web:** the `(user)` layout reads both id sets once and wraps the tree in `components/reactions/reactions-provider.tsx`; `useReactions()` is the single source for every control; toggles are optimistic with rollback-toast, disable while pending, bounce visitors to `/login`, and ignore non-UUID (mock) ids. `/me/likes` + `/me/saved` render real listings via `components/profile/reaction-ads-panel.tsx`. Not included: notifications on like/save; admin surfaces; counts anywhere but the detail control.

### Job Applications (`src/applications/`, 2026-10-16)

**`job_applications`** (`db/schema/applications.schema.ts`, migration `0036_job_applications`) — one row per (listing, applicant), `job_application_status` = `pending|viewed|hired|rejected`. `poster_id` is denormalized from the listing (the poster's list is the hot read, and ownership never transfers); both user FKs and the listing FK cascade. `CHECK (applicant_id <> poster_id)` backstops the service's 400.

```
POST   /api/v1/listings/:listingId/applications   apply (throttled 10/min)
GET    /api/v1/users/me/applications              mine; ?listingId= is the detail page's "already applied?" read
GET    /api/v1/users/me/applications/received     to my listings
GET    /api/v1/users/me/applications/:id          either party; poster's first read flips pending→viewed
PATCH  /api/v1/users/me/applications/:id          poster sets viewed|hired|rejected ("pending" is not settable)
POST   /api/v1/users/me/applications/:id/cv/sign  poster-only signed URL for the CV the application carried
```

**Chat is the delivery channel, and the order is the failure policy.** `apply` validates first (unknown listing 404, non-job 400, own listing 400, non-`active` 400, soft-deleted poster 404, blocked pair 403, duplicate **409** `JOB_APPLICATION_EXISTS` with the existing id), then **sends the chat message through `ChatService.sendMessage`** (the single chat write path, called in-process) with `clientMessageId = "apply:<listingId>:<applicantId>"` — the send replays idempotently on retry — and **only then inserts the row**, so a failed send can never leave a phantom application. **The message is encrypted in the applicant's browser (2026-10-30):** the DTO carries `body` (ciphertext) plus a v2 `e2e` or v1 `e2eHeader` payload composed by `sendE2eText`; the server composes no text and reads none, and `ApplyResultView.chat` returns the delivery ids so the browser can commit its ratchet session. A half payload is a 400; a plaintext body can never reach the DB. **When the poster has no encrypted-chat devices** the client omits the payload and the application is recorded without a chat message (`chat: null`) — the dialog explains it, and the service runs `isBlockedEitherWay` itself so a blocked pair still 403s (the chat path is what normally enforces it). The insert is `onConflictDoNothing().returning()`, and the poster's notification is gated on the returned row (the `follow.created` rule): a duplicate or a lost race never double-notifies. No transaction spans the two writes (`ChatService` runs on the shared client) — the same honest non-transactionality `follow.created` carries. `@Throttle` on the route is load-bearing: a `ChatService` call in-process runs no controller guard.

**The résumé is frozen into the row, not referenced.** `resumeSnapshot` (JSONB) is `ResumeService.getDocument()`'s output at apply time — editing the CV later cannot rewrite an application a poster already read — and it is the *only* path by which any other account sees a résumé, exactly as `resume.controller.ts` and `.pipeline/spec.md` Decision 13 specified. `GET /resume` and `POST /resume/attachments/sign` stay owner-only; the poster's CV download goes through `POST .../cv/sign`, which proves the caller is `poster_id` and then calls `ResumeAttachmentsService.signAttachmentById` (a deliberately internal primitive — never wire it to a controller). The CV *file* is never copied: the snapshot carries its id, and a CV removed or replaced since answers **409** `RESUME_CV_REMOVED`, which the UI renders as "no longer available" while the résumé text still renders. A stranger gets 404 on the application and on the CV; the **applicant** also gets 404 on the CV route (their own CV lives at `/me/resume`).

**Web.** `components/post/ApplyJobButton.tsx` + `ApplyJobDialog.tsx` — the orange button sits in the job detail price row (job listings only, hidden on your own ad and off-`active` jobs, anonymous → login). `lib/api/job-apply.ts#loadJobApplyState` is the shared fail-soft read both detail routes call. On job listings the header is the captain's mock layout: the gallery renders as a narrow **thumbnail column on the left** (`<PostImage variant="thumbs">`) with the title, meta row and price/Apply block beside it, the like/share pair moving out of the photo overlay to the title row (`components/post/PostSocialActions.tsx`, shared with `PostImage` — one component, no third copy; `showActions={false}` on jobs so it never renders twice). A job with no logo renders no column and the details take the full width. Every other listing keeps the hero gallery. The two /me pages are real: `components/profile/{Apply-Jobs,Job-Applications}.tsx` fetch through `actions/applications.ts` and render `JobApplicationRow`; the poster's row opens `ApplicantResumeDialog` (the frozen snapshot, loaded on open), which is also what marks the application viewed.

### Reports (`src/reports/`, 2026-10-17)

Customer-facing reporting + admin take-down. The new `ReportsModule` is separate from the admin module `src/admin/reports/` (that one is class-level `@Roles` and must stay so):

- `GET /api/v1/reports/reasons?targetType=user|listing` — `@Public()`, active reasons ordered `sortOrder, reason` (the dialogs' picklist; the seed carries 12 per type).
- `POST /api/v1/reports` — JWT, `@Throttle` 5/min. Body `{targetType, targetId, reasonId, description?, imagePaths?}`. Validates: target exists (a soft-deleted user is 404), self-report 400 `CANNOT_REPORT_SELF`, reason must match the target type and be active (`INVALID_REASON`), one **pending** report per reporter→target (409 `REPORT_ALREADY_PENDING`, pending-only: a rejected one may be re-filed), evidence paths must live under `report/{reporterId}/` (`INVALID_IMAGE_PATH`). `POST /files/sign` gained the `report` scope with the same per-user prefix. The web's **listing** dialog is reason + description only (captain's mock, 2026-10-19); the account dialog is the mock's 24-slot evidence strip (real uploads, DTO cap 24) — `imagePaths` stays optional for both in the API.
- Approving **takes the target down**, in one transaction with the verdict. A listing report sets `listings.status='deleted'` + `taken_down_at`: the feed's `liveConditions` and the public `findById` both hide it, and `publish()` refuses with 403 `LISTING_TAKEN_DOWN`. A user report sets `users.status='suspended'`, takes down every listing the account owns (`status='deleted'` + `taken_down_at`), and inserts every phone on the account into **`banned_phones`** (normalized E.164, unique). `isPhoneBanned` is enforced at `register`/`otp/request`/`otp/login`/`otp/verify`/`mirrorSupabaseUser`/add-phone → 403 `PHONE_BANNED`, and `verifyPhoneOtp` now rejects a suspended account (it bypasses `loginWithPassword`). The ban is keyed on the number, not the user row, so it survives a hard purge.
- **Rejecting never restores.** Approving then rejecting rewrites the verdict only — the listing stays down, the account stays suspended, the phones stay banned (v1, deliberate; tests pin it).
- The seed stopped fabricating sample `user_reports` (it inserted a row on every run — 56 had accumulated) and deletes the old marker rows; `reports.seed.ts` now seeds 24 reasons (12/type) with explicit `sortOrder`.

### Feedback (`src/feedback/`, 2026-10-21)

Public product feedback from `/feedback`, plus its admin queue. `feedback` (migration `0042`) is one row per submission: `{ user_id?, name, phone, email?, description, image_paths, created_at }`; `user_id` is **SET NULL** on purge (anonymous submissions are null) so the queue survives an account deletion.

```
POST /api/v1/feedback                    → @Public() + OptionalJwtAuthGuard (5/min); `userId` stamped when signed in
POST /api/v1/feedback/attachments/sign   → @Public() (30/min) signed upload URL, folder feedback/<uuid>/
GET  /api/v1/admin/feedback              → newest first; `imageUrls` derived from the stored paths
DELETE /api/v1/admin/feedback/:id        → 404 when missing
```

`imagePaths` must start with `feedback/` (400 `INVALID_IMAGE_PATH`); the web form's photo strip is **optional** (the mock's "upload at least one image" alert contradicted the unstarred Photo header). `/files/sign` stays JWT-only, so the dedicated public sign door exists for anonymous submitters. The admin list maps storage paths to public URLs via `FilesService.getPublicUrl()`, and the web renders them through `DbImage`. The web form mirrors the DTO caps (`maxLength`: name 200 / email 254 / description 2,000) with live counters under Name and Description that turn red and read "Maximum reached — n/max" at the cap; the admin table clamps name (2 lines), email (1 line) and description (3 lines) and offers a **Read full text** dialog for long descriptions, so a pasted wall of text cannot stretch a row. Deleting a feedback row does **not** delete its storage objects (matches report evidence).

### Advertisements (`src/advertisements/`, 2026-10-26)

Superadmin-managed storefront banners. `advertisements` (migration `0042`) is one row per banner: `placement` (`home | all_ads | category | subcategory | listing_detail`), the Storage `image_path`, optional `link_url`, `alt_text`, `sort_order`, `is_active`, `created_by_id` (SET NULL). One row is one banner in one slot; a slot holding several active rows rotates them.

```
GET    /api/v1/advertisements?placement=<enum>   @Public — active only, sort_order then created_at
GET    /api/v1/admin/advertisements              super_admin, all rows
POST   /api/v1/admin/advertisements              super_admin
PATCH  /api/v1/admin/advertisements/:id          super_admin
DELETE /api/v1/admin/advertisements/:id          super_admin
```

The public row exposes `{id, placement, imageUrl, linkUrl, altText, sortOrder}` — never `imagePath` or `isActive`. `placement` is an enum DTO (unknown → 400), unlike the unvalidated `attributes/:type` param. The module is standalone for the same reason `FeedbackModule` is: a controller inside `AdminModule` inherits its class-level admin guard, and this feature needs an anonymous read. Images upload through the staff-only `advertisement` sign scope into `advertisement/<uuid>-<name>`; replacing or deleting a banner removes the old object **after commit** (the documented pattern), and `FilesService.remove` never throws.

**Web:** `lib/api/advertisements.ts` (fail-soft, `[]` on failure) feeds `components/ads/AdvertisementCarousel.tsx` — embla (already a dependency): 5 s autoplay, dots, pause on hover/focus, `prefers-reduced-motion` opt-out, `DbImage` for the image, and `null` when a slot is empty. The four RSC pages fetch their own slot; `Post-Detail.tsx` is a client component, so its two wrappers (`[slug]/page.tsx`, `post/[slug]/page.tsx`) fetch `listing_detail` and pass `banners` down. The dashboard page is `app/wanderer/dashboard/advertisements`, shown only to `super_admin` through each sidebar entry's `roles` list (the same mechanism Team uses). **A `"use server"` module may export only async functions** — the placement list and row types live in `lib/advertisements.ts` for exactly that reason; a constant exported from the actions file surfaces as the dashboard's generic error boundary.

**Bucket limits:** the storage bucket (env `SUPABASE_STORAGE_BUCKET`, here `product-images`) allows exactly `image/jpeg | image/png | image/webp` and caps files at 5 MB; `image/gif` is refused by Supabase with `invalid_mime_type` before the backend sees it. Animated WebP **is** allowed, so an animated banner keeps its animation: the old 2.1 MB flag GIF converts to a 381 KB / 25-frame WebP. Allowing GIF would be a bucket-settings change in Supabase, not a code change.

### Insights (`src/insights/`, 2026-10-19)

`InsightsModule` owns `listing_events` (migration `0038`) and the `/insight` page's data. Every row
is `{listing_id, owner_id, actor_id, event_type, created_at}`; `owner_id` is denormalized from the
listing (there is no transfer path), and `actor_id` is **`ON DELETE SET NULL`** so an account purge
never subtracts historical engagement from someone else's totals. Six event types:
`impression | view | chat | call | show_contact | apply_job`.

- `POST /api/v1/insights/events` — `@Public()` + `@SkipThrottle()` + `OptionalJwtAuthGuard`. A batch
  of ≤ 50 events; anonymous visits are recorded with a null actor, a valid token identifies the actor
  so the owner's own actions are skipped, and unknown listing ids are dropped rather than failing the
  batch. The route is deliberately unthrottled: the web calls it through a Next server action, so the
  backend sees the Next/Vercel egress IP and an IP-keyed bucket would throttle every visitor together
  (the 50-event cap is the v1 bound).
- `GET /api/v1/insights/me` — JWT; all-time account-wide counts plus `engagement` =
  `view + chat + call + show_contact + apply_job` (impressions excluded).
- Web instrumentation: `apps/web/lib/insights/queue.ts` (actions fire immediately; impressions batch
  at 500 ms / 30 events) + `hooks/use-listing-impression.ts` (IntersectionObserver, ≥50% visible,
  once per listing per page document). Hook points: the detail view, Message seller, the `tel:`
  phone links, Show Phone/Email, and Apply For This Job. `listings.views_count` remains unused;
  never write it from `GET /listings/:id` (metadata and detail reads would double-count).

### Notifications (`src/notifications/`)

User-facing notification feed. `NotificationsModule` is deliberately **not `@Global()`** (importing it is a choice to send notifications). Routes (all JWT):

```text
GET    /api/v1/notifications              → offset-paginated (page/pageSize ≤ 100), newest first
GET    /api/v1/notifications/unread-count → { total }
PATCH  /api/v1/notifications/read-all
PATCH  /api/v1/notifications/:id/read
DELETE /api/v1/notifications/:id
DELETE /api/v1/notifications
```

`notify()` fans out over an injected `NotificationChannel[]`; today's only channel is `InAppNotificationChannel`, which inserts the durable `notifications` row (migration `0024`) — email/push are the extension point (add a channel to the provider array, nothing else changes). `Promise.all`, not `allSettled`, on purpose: the durable row's failure must propagate (the payment handler answers `retry`). Producers today: `follow.created` (`users.service.ts`), payment settlement (`payment/outbox/payment-settled-outbox-handler.ts`), and the hourly listing-expiry sweep (`listings/listing-expiry.service.ts`: `listing.expiring` at T-3 days, `listing.expired` once within 24 h of the lapse; both deduped by (listingId, expiresAt) in `data`). **Web:** `/[locale]/(user)/notifications` is real (anonymous → login), page one server-fetched via `actions/notifications.ts`, mutations via server actions.

### Chat

`ChatModule` (`src/chat/`) — 1:1 buyer↔seller messaging. **REST is authoritative; the WebSocket gateway is an optional low-latency push on top.** Every message (REST or WS) goes through the single `ChatService.sendMessage` write path; its three pre-write checks (recipient exists, block check, listing ownership) run concurrently via `Promise.all` — each is an independent read against the remote pooler. The shared postgres.js pool (`DATABASE_POOL_MAX`, default 20) is the real scaling limit under concurrent chat traffic. **Per-contact threads:** exactly one `conversations` row per unordered pair (CHECK `user_a_id < user_b_id`; upsert bumps `last_message_at`). Messages may carry an optional `listingId` context card (`ON DELETE SET NULL`). All routes require JWT. Full design: `src/chat/README.md`.

```
POST /api/v1/chats/messages      → send { recipientId, body?, listingId?, imagePath?, e2eHeader? }; find-or-creates the conversation
GET  /api/v1/chats               → inbox: cursor on (lastMessageAt, id); items carry otherUser, lastMessage, unreadCount
GET  /api/v1/chats/unread-count  → { total }
GET  /api/v1/chats/with/:userId  → resolve thread (read-only — never creates; conversation may be null)
GET  /api/v1/chats/:id/messages  → history (cursor=, DESC) or polling deltas (after=, ASC); meta adds latestCursor + peerLastReadAt
POST /api/v1/chats/:id/read      → bulk mark-read → { marked }
```

Send rejections: self 400, no body & no imagePath 400, imagePath outside `chat/{senderId}/` 400, recipient missing/soft-deleted 404, block either way 403, listing owned by neither 400. Non-participants get 404 (not 403) on conversation routes — no existence oracle. Clients poll with `after = meta.latestCursor`; read receipts surface via `peerLastReadAt` (= `max(readAt)` of my messages, valid because mark-read is bulk). `messages.created_at` and `conversations.last_message_at` are `timestamp(3)` so cursor values round-trip through JS Dates without re-delivering the boundary row.

**WebSocket gateway** (`chat.gateway.ts`, `/ws/chat`): auth via `?token=`, `Authorization` header, or the `user_access_token` cookie (browsers can't set WS headers), then the same soft-delete DB check the REST path runs. `send_message` is rate-limited in-memory (30/min per user, mirroring REST's `@Throttle`); payloads are validated in the handler with the REST `ValidationPipe` options; every send gets exactly one frame echoing `clientMessageId` — `ack` or `error` with the REST error codes. `markRead` pushes a `read` event to the other participant. `ConnectionRegistry` is per-process, but `ChatPubSubService` publishes every push (`message`, `inbox_update`, `unread_count`) over Redis pub/sub so any instance delivers to its own sockets; an offline recipient still catches up via `after=` polling. `HeartbeatService` pings every 30 s and evicts after 40 s without a pong. **Web:** `use-chat-ws.ts` holds one shared socket per tab (ref-counted); pushes replace the flat-interval inbox/badge poll when connected (`CHAT_POLL` tiers otherwise).

**End-to-end encryption** (X3DH + Double Ratchet over `@noble/curves`): `SendMessageDto.e2eHeader` (v1: optional; text only, base64 ciphertext ≤ 24000 chars, mutually exclusive with `imagePath`) marks a message E2E; the header carries the ratchet fields plus, on a session's first message, the X3DH init fields. Key material: `user_e2e_identities` (X25519 identityKey + a **separate** Ed25519 `identitySigningKey` — `@noble/curves` can't do Signal's XEdDSA one-key trick) and `user_e2e_one_time_prekeys` (claimed one at a time). `E2eKeysController` (`/chats/e2e/keys`): register/rotate + replenish prekeys; `me/prekey-count`; `:userId/bundle` (identity, signing key, signed prekey + signature, one claimed one-time prekey). The backend stores and relays key material and ciphertext only. **v2 multi-device** (`e2eVersion=2`): one identity per browser (`user_e2e_devices`), message keys wrapped per recipient/sender device in `message_envelopes`; a stale device list → 409 `E2E_DEVICES_MISMATCH` with `details` to fix and retry. **History backup** (`e2e-backup.*`, `/chats/e2e/backup`, `/chats/e2e/history-requests`): a per-account backup key encrypts plaintext segments; a new device gets BK via passcode (argon2id → rate-limited unlock) or approval from an existing device. Plan: `tasks/plan-e2e-multi-device.md`; open security items: `src/chat/README.md`. **Encrypted attachments** (`chat-attachments.*`, `/chats/attachments`, plan `tasks/plan-e2e-attachments.md`): browser resizes to WebP, encrypts each file with AES-256-GCM (frozen `E2E_FILE_V1`: `NPF`+version, IV, ciphertext+tag), uploads ciphertext to the **private** `chat-files` bucket (octet-stream, 25 MB cap); keys/MIME/thumbnails ride inside the v2 message. `chat.attachments` tracks `pending → uploaded → attached`; `complete` trusts only the size read from storage; sends attach `attachmentIds` with one conditional UPDATE; downloads use 5-min signed URLs issued only to participants; integrity is recipient-verified (no server-side hash). An hourly BullMQ job deletes objects+rows never attached within 24 h. Legacy `imageUrl` images stay public; `NEXT_PUBLIC_E2E_ATTACHMENTS=off` falls back to them.

### Files

`FilesModule` (`src/files/`) — uploads to Supabase Storage. Signed upload URLs are generated server-side; the client uploads directly. Bucket via `SUPABASE_STORAGE_BUCKET` (default `listings`). **Upload scopes** (`POST /files/sign`): `avatar | cover | listing | chat | report | resume | category | subcategory | brand | model | product | attribute | advertisement` — `chat` paths are per-user (`chat/{userId}/…`) so ChatService can verify ownership by prefix; `category/subcategory/brand/model/product/attribute/advertisement` are staff-only. `DELETE /files` takes `{ paths: string[] }`.

**Image cleanup on replace/delete:** `FilesService.removeByPublicUrl(publicUrl)` derives the storage path from a public URL, silently skips non-storage values, and warns but never throws. Pattern: read the prior value inside the DB op, call `removeByPublicUrl(old)` **after commit**, gated on the value actually changing. Wired for: attributes, brands, models, categories/subcategories, user avatar/cover, listing photos. **Not** wired for: admin user soft-delete, chat images (no message-delete endpoint by design), listing soft-delete (restore must work).

### Payments

`PaymentModule` (`src/payment/`) — gateway-agnostic payments feeding a double-entry ledger; full design in [`src/payment/README.md`](apps/backend/src/payment/README.md) (**the canonical Module README**). Convention unique to this module: **use-cases are written in [Effect](https://effect.website)** — `use-cases/payments/` (transaction/attempt/provider-event lifecycle) + `use-cases/ledgers/` (double-entry posting) are `Effect.fn` generators that `yield*` a `DbClientTag` (`src/db/db.provider.ts`, wrapping the same Drizzle client) and fail with `Schema.TaggedError` classes instead of throwing. `PaymentsController` is the only bridge back: a private `run()` provides `DbClientTag.layer(this.db)`, runs with `Effect.runPromiseExit`, and maps typed failures to `HttpException` via a `switch` on `error._tag` (unmodeled defects → 500). Don't reach for `effect` elsewhere without deciding to extend the convention.

**Provider webhooks** live in their own module: `POST /api/v1/webhooks/aba-payway` (`src/webhooks/`) — `@Public()` (ABA calls server-to-server) but verifies ABA's HMAC-SHA512 over the JSON-stringified body against `X-PayWay-Hmac-Sha512` **before any DB write** (401 on mismatch), then hands off to `receivePaymentProviderEvent` + `PaymentEffectRunner`. Configured by `ABA_PAYWAY_WEBHOOK_URL`.

### Adding a new feature module

1. Create `src/<feature>/{feature}.module.ts`, `.service.ts`, `.controller.ts`; DTOs in `dto/`.
2. Import the module in `AppModule`; mark public endpoints `@Public()` (everything else needs a JWT automatically).
3. Do **not** import `DbModule`/`SupabaseModule` — their providers are global.
4. **Admin-only features** go into `AdminModule` (`src/admin/admin.module.ts`), and the tier is a deliberate choice: catalogue/user/subscription work is `@Roles('admin')`, governance work (stats, reports, team, feedback) names both roles, and a content surface only the superadmin controls gets `@Roles('super_admin')` in a standalone module. Exception: attributes own their module (`src/attributes/`) so they can grow a public surface.

### Repository history note

The admin dashboard was originally `apps/admin` (a nested git repo — moved with plain `mv` + `git add -A`). Stale references to `apps/admin` / `pnpm --filter admin` mean `apps/web` / `pnpm --filter web`.

### Admin API (`/api/v1/admin/*`)

`AdminModule` registers all admin controllers; every route requires a staff role (no `@Public()`). **Since 2026-10-26 most are `@Roles('admin')`** — category/subcategory/brand/model CRUD, listings, attributes, subscription config and user-subscriptions — while only `AdminController` (stats + users) and `ReportsController` also admit `super_admin`.

| Controller | Routes |
| ---------- | ------ |
| `AdminController` | `GET /admin/stats`, `/admin/stats/timeseries`, `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/:id` |
| `AdminCategoriesController` / `AdminSubcategoriesController` | CRUD + translations |
| `AdminBrandsController` / `AdminModelsController` | CRUD |
| `AttributesController` (own module) | `GET/POST/PATCH/DELETE /admin/attributes/:type` |
| `SubscriptionConfigController` / `UserSubscriptionsController` | Group/tier/term config CRUD (three admin pages under `/wanderer/dashboard/subscription`); grant/delete user subscriptions |
| `ReportsController` | `GET/POST/PATCH/DELETE /admin/reports/reasons`, `GET/PATCH/DELETE /admin/reports/{users,listings}` — PATCH approve takes the target down (see Reports) |
| `AdminProductsController` (own module) | `GET /admin/products?family=`, `GET /admin/products/template/:family`, `POST/PATCH/DELETE /admin/products/:id` |
| `AdminFeedbackController` | `GET/DELETE /admin/feedback` |
| `AdminAdvertisementsController` (own module) | `GET/POST/PATCH/DELETE /admin/advertisements` — super_admin only |

**Stats:** 4 cards (`totalUsers`, `newUsers`, `totalListings`, `activeListings`) with `{value, changePct, trend}` (30 d vs prior 30 d); timeseries returns daily `{date, newUsers, newListings}` bucketed in ICT (UTC+7). **Users:** offset-paginated with `q`/`role`/`status`; premium derived via EXISTS on active subscriptions; create/update hashes bcrypt(10) + writes phone rows in a transaction; delete is soft-delete (frees `user_phones`). **Seed bootstrap:** `src/db/seed.ts` upserts an admin when `ADMIN_SEED_USERNAME` + `ADMIN_SEED_PASSWORD` are set — the only path to the initial admin.

## Web app architecture (marketplace + admin dashboard)

`apps/web` (Next.js 16 App Router, port 3001) talks to the backend at `http://localhost:3000/api/v1` (`API_URL` env, baked into `lib/api/client.ts`).

### Auth flow

**Admin (`/wanderer/*` — non-localized, no `/[locale]` prefix):** `actions/admin-login.ts` calls `POST /auth/login`, rejects unless `admin`/`super_admin`, persists httpOnly cookies `admin_access_token`/`admin_refresh_token`, and seeds the `admin_locale` cookie. `proxy.ts` (Next 16's middleware) guards `/wanderer/dashboard/**` on cookie *presence* only — **not the real gate**: `app/wanderer/dashboard/layout.tsx` calls `getCurrentUser()` and redirects unless the session is admin (defense in depth; a placeholder cookie passes the proxy and is still bounced — verified 2026-09-15). `app/wanderer/layout.tsx` is a **second root `<html>` layout** that reads `admin_locale` and wraps children in `NextIntlClientProvider` with directly-imported messages (bypassing the URL-segment i18n). `LocaleSwitcher` → `actions/admin-locale.ts` (cookie + `PATCH /users/me`) + `router.refresh()`. `actions/logout.ts` exposes `adminLogout` + `userLogout`.

**User (`/[locale]/login`):** `actions/login.ts` accepts any authenticated user. **Phone-shaped identifiers** (`^0\d{7,9}$` — local only; typed `+855…`/`855…` counts as a username and fails) route to `requestLoginOtp` (`actions/otp.ts` → `POST /auth/otp/login`): password validated first, then OTP sent, redirect to `/{locale}/otp?phone=<E.164>`. **Distinct cookie pairs:** admin vs `user_access_token`/`user_refresh_token` — a user login can't satisfy the admin guard. Post-login destination is always `/me`.

`serverFetch<T>/userServerFetch<T>` (`lib/api/client.ts`) read the matching httpOnly cookie, inject `Bearer`, unwrap the envelope, and transparently refresh once on 401 (set new cookies, retry; on refresh failure clear that session). `clearAdminSession()` during RSC render throws (read-only context) and is swallowed. `getCurrentUser()` (`lib/auth/current-user.ts`, server-only) is the fail-soft session reader — anonymous fast-path with zero backend calls; any error degrades to visitor chrome.

### Category + subcategory pages (backend-driven)

`/[locale]/category/[categorySlug]` and `.../[subcategorySlug]` are async RSC fetching `GET /categories/:slug` (one call; the response nests subcategories). Plumbing lives in **`lib/api/categories.ts`** (server-only; envelope unwrap; `null`/`[]` on failure): `getCategoryWithSubcategories`, `getBrandsForSubcategory`, `getBodyTypes`, `getModelsForBrand`, `getAttributeOptions`/`getLinkedAttributeOptions` (one call returns every attribute row linked to a subcategory), `getListingsFeed` + `toCardPost`, `getListingById` + `buildRealDetailData`, `getAllCategories`. Grid components use **local minimal types**, never mock/backend DTOs; images render **`unoptimized`** (admin Supabase URLs would crash `next/image`).

**Filter bar / grid-list toggle:** the four `components/category-layouts/*CategoryLayout.tsx` render the title + sticky bar using the shared `components/filter/*` components (URL-param driven; `PriceFilter` takes a `label` — jobs passes "Salary"). The **category page owns the `Tabs` root**; grid/list content = `GridCardPost` / `ListCardPost` with the real feed. The filter bar keeps an equal 8 px gap on both sides.

**Price semantics:** `listings.price` is the ORIGINAL seller input; the discount applies on top (`applyDiscount` in `lib/utils.ts`). Cards/detail show the final bold + original strikethrough when discounted, with %-OFF/$-OFF badges. A NULL price ("Negotiable" — Services and three Home & Land forms declare no price) renders as "Negotiable", never `$0`; `Post.price` is `number | null` on purpose so `tsc` enumerates every reader.

**Jobs category page:** renders the `jobtypes` `OptionGrid` below the tiles' Show More, filtered to rows ticked for the category's subcategories; the pick filters the feed via `attrKey=jobType&attrValue=<name>` and carries into the chosen job. Both Show More bars are equal-width; a bar renders only when rows are hidden (jobs 36→24 has one; services 24 = LIMIT has none, by design).

### Real listing surfaces

**Every one of the 146 subcategories is opted in** (`REAL_FORM_SUBCATEGORIES` in `post/(publish)/page.tsx`), so nothing reaches the legacy mock `DynamicForm` except a subcategory created through the admin UI after 2026-09-28 (its `field_schema` is NULL and its slug can't be listed — see Known gaps; do not "simplify" the gate to `fields.length > 0`).

- **`components/post/ListingPostForm.tsx` is schema-gated**: every block renders iff its key is in the subcategory's backend `field_schema` (`config.fields`). A key with no render block vanishes silently — that comparison is the opt-in checklist. Blocks render in a FIXED JSX order (not schema order) with a per-subcategory **`CONDITION_SLOT`** map: `lead` (laptops/desktops/printers/parts), `afterScreenSize` (all-in-one/monitors), `beforeBodyType` (lorries — falls back if no bodyType), default after Tax Type. The four contradictory layouts are why this is a list, not a rule.
- **Required-ness is hardcoded per block, never read from `field_schema.required`** (that flag disagrees with the design). Starred + enforced: title, brand, year, taxType, condition, color, price, description, location, address, name, first phone, accessory, network, jobType, experience. Exception: **`STORAGE_REQUIRED`** — storage starred on computers, not on phones. `TYPE_OPTIONAL` covers the four Home & Land forms that leave Type unstarred. Model is `disabled` until a Brand is chosen. `deliveryFree` is the one payload field sent unconditionally even when not declared (inert; backend default matches).
- **Pickers:** option lists come from `config.pickLists`, resolved per key by `PICKER_ATTR_TYPES` — admin-managed sets win when any row carries `subcategoryIds` (unticking authoritative); `storage` maps to `null` on purpose (two backing sets, per-category inline options are authoritative); `jobType → jobtypes`, `experience → experiences`, `accessory → accessories` (one set serves Phone Accessories + Fashion Accessories; "Accessory Type" is just fashion's own schema label; a `fashion_accessories` split was built and reverted — one shared set is the decision), `network → networks`. Labels come from `config.labels[key]` (so jobs reads "Job Title"/"Minimum salary"); `photoMax` comes from the schema's `photos.max` (jobs = 1 and reads "Logo", `Max: n / 1`).
- **Notable history:** the jobs family's key was renamed `type` → **`jobType`** because `type` maps to the managed `types` set, which has no rows ticked for jobs — an empty picker on a starred field. Same trap class: `bathrooms`/`bedrooms` are plain form fields, never grids.
- **Photos:** `ImageUpload` (extracted, `signFn`/`onSigned` props; `onSigned` returns the storage `path`) — it is the one block with **no render gate** (a form without `photos` would still show a dropzone at max 8; all 146 declare photos, so inert).
- **Layout (captain's mock):** Photos → Post Details (title; a dashed *Choose a category* box; every field full-width; Brand/Model/Year/Engine/Body/Color are searchable `SearchPicker`s; Transmission/TaxType wide buttons; Condition above Color; Price with `$`; Discount with %/$ toggle; Free Delivery switch; tall Description; three-level province→district→commune `LocationPicker`; Address textarea; map block) → Contact (name, phone rows with blue + / red ⊖, email, agreement line, full-width orange Submit).
- **SearchPicker scrolling (fixed 2026-09-16):** `max-h-[296px]` (6 whole rows + padding — 320 px sliced row 7), `overscroll-contain` (wheel past the end scrolled the page 2313 px), a non-passive native wheel listener on the input (React's onWheel is passive — `preventDefault` is a no-op), and a slim always-visible scrollbar (Chromium overlay scrollbars gave 0 px).
- **Location map:** Leaflet + OpenStreetMap only (no Google key). `LocationMapCanvas.tsx` is the **only** leaflet importer and is reached via `next/dynamic(…, { ssr: false })` (Leaflet touches `window` at import). Map wrappers carry `isolate z-0` (Leaflet panes use z-index 400/800). The detail page re-renders the pin with a keyless Google Maps link; no geocoding of typed text yet (parked).
- **Feeds + detail:** `getListingsFeed({categorySlug|subcategorySlug|brand|bodyType, …}, locale)` + `toCardPost()`; empty real feeds render the `GridCardSell` card alone. Detail: two entry points (`[locale]/[slug]` root `title-adid-<uuid>`, and `[locale]/post/[slug]`) resolve through `buildRealDetailData` into `Post-Detail.tsx` via its `real` prop; the seller card comes from the listing's contact fields (no anonymous `GET /users/:id` — it's JWT), and `sellerUsername` comes from the listing, not the free-text contact name.
- **Carrier icons:** `utils/telecom.ts` `detectCambodiaNetwork()` + `carrierIconPath()` (Cellcard/Metfone/Smart/Seatel/Qube; **seatel is `['018']` only** — its array was once a duplicated Smart list). `CarrierBadge` renders a 16 px icon or the S/C letter-badge fallback. **Each phone/company/email row renders only when it has a value** — no empty rows, no dangling dividers.
- **Description specs grid (`ListingSpecs.tsx`):** real listings render grey-label/blue-value rows between the Description h2 and the text. Rows = Main Category + Category, then Brand/Model (best-effort `?ad_field=` links via `slugify` — can diverge from `brands.slug`), then `ATTR_KEYS` order: year, taxType, bodyType, vehicleType, engineType, transmission, color, jobType, experience, **bedroom, bathroom, facing, size** (singular — `listings.seed.ts` was corrected to match the schema), type, accessory, screenSize, storage, ram, cpu, vga, network. Condition is inserted only for condition-carrying categories, positioned by **`conditionPreKeys`** (Year/TaxType + the "what kind of thing is this" pickers: vehicleType, type, accessory, and storage — the last scoped through `STORAGE_BEFORE_CONDITION` because computers keep Condition where it is). `VALUE_SUFFIX` appends units on display (today only `size: "m²"`). **`condition` is NOT inside `attributes`** (top-level column) — the grid reads `real.*`, never the local mock `post`. `company` is deliberately NOT a grid row — it sits as the first row of the seller card in `Profile-Sidebar.tsx` (building icon, plain text, only when present).
- **Whole-catalog browse:** chip sets come from `CATEGORY_HEADER_FLAGS`/`SUBCATEGORY_HEADER_FLAGS`; every linked attribute row arrives in ONE call (`GET /attributes?subcategoryId=`, JSONB `@>`), rendered per set via `ATTRIBUTE_SET_TITLES`. **An applied set steps aside** (picking a value removes that grid), brand → model drill-down follows the same rule, and a pick resets the view to top (`router.push(url, { scroll: true })` — `replace`+`scroll:false` kept the offset and overwrote history). Grid clicks filter via `?ad_type=<slug>` plus **`SET_FIELD_KEYS`** resolving the storage key from the clicked set against the subcategory's own `field_schema` (the same `bodytypes` set stores as `bodyType` on cars but `vehicleType` on rent/parts); an unresolvable set falls back to the legacy `bodyType` path. `vehicletypes` is retired (it duplicated `bodytypes`); `colors` was scoped to the two subcategories that declare a colour field — `ATTRIBUTE_SET_TITLES` (not linking) is the control that keeps plain-dropdown sets out of browse.
- **Images rule (captain, 2026-09-10):** every DB image renders through `components/common/DbImage.tsx` — the only sanctioned wrapper: source must be a Supabase **Storage object URL** (`isStorageObjectUrl`); a bundled `/sub-img/…` path or foreign host is rejected exactly like a missing object, and a failed load degrades to the caller's no-image state (never a static stand-in, never a broken `<img>`). `DbImage` defaults `unoptimized` — keep it, or `next/image` throws on the unconfigured hostname and takes the page to the error boundary.
- **Design follows the set, never the load result:** `OptionGrid` picks icon-circle vs bordered-text from the set's declared design (`IMAGE_TILE_SETS` at the page: accessories, bodytypes, jobtypes, networks, types; brands at the call site; `TEXT_TILE_SETS_BY_CATEGORY` carries the one exception: furniture's `types`). The map lives in `apps/web/lib/attribute-types.ts` because the post form obeys it too (`getListingFormConfig` nulls `image` on text-only pickers so `SearchPicker`'s sniff finds nothing). Models are always text tiles.

### Page conventions

Admin pages under `app/wanderer/dashboard/` are `"use client"` components: `useQuery` with `["admin", <domain>, …]` keys, client-side search/tab filtering/pagination on the full dataset, `invalidateQueries` after mutations, `toast` from `@/components/ui/sonner`. **Verbose-adapter pattern:** map backend rows → UI types inside the `queryFn` (the adapter lives in the page). **Batch-lookup pattern:** when a query needs names for two FKs into `users`, collect ids → one `inArray` query → `Map` in JS (avoids Drizzle double-JOIN alias issues).

### Key files

| File | Purpose |
| ---- | ------- |
| `lib/api/client.ts` | `serverFetch`/`userServerFetch` — typed client with auth + refresh |
| `lib/api/adapters.ts` | `BackendUser` + `toUiUser()` |
| `lib/auth/session.ts`, `lib/auth/admin-locale.ts` | cookie helpers (tokens; `admin_locale`) |
| `lib/auth/current-user.ts` | `getCurrentUser()` — fail-soft server session reader |
| `proxy.ts` | admin cookie guard + next-intl middleware |
| `app/wanderer/layout.tsx` | admin root layout (cookie-locale provider) |
| `actions/*.ts` | server actions: login/admin-login/otp/logout/logout, admin CRUD, listings, files, notifications |
| `lib/phone.ts` | `normalizePhone` / `formatPhoneLocal` / `isLocalPhone` |
| `lib/attribute-types.ts` | `ATTRIBUTE_TYPES` (6 admin-managed types) + the image/text tile-set declarations |
| `lib/api/categories.ts` | the server-only hub for every backend-driven surface |
| `components/common/DbImage.tsx` | the only sanctioned DB-image renderer |

## Mobile app (Expo)

`apps/mobile/` (package **`phsarkhmer`**) is the Expo SDK 54 / React Native 0.81 client — expo-router file-based routes, NativeWind 4 + Tailwind 3, React Query 5 (provider mounted, nothing queries yet), context providers (auth/language/notifications/theme), `expo-camera` for the scan screen. Standalone like `apps/web`: no `@repo/*` imports.

**Status: a mock-data UI prototype** — no API client (no fetch/axios, no base-URL env), `AuthContext` ships a hardcoded `DEFAULT_USER` with a state-only `login()`, screens read `constants/data/*` (see Known gaps).

**Workspace-hoisting hazard:** sharing the pnpm workspace means its install can hoist a conflicting copy of a shared tool and break a _different_ package — a hoisted `jest-environment-node@29.7.0` broke the backend jest suite (fixed 2026-10-06 by pinning `jest-environment-node@^30.4.1` in `apps/backend` devDependencies), and duplicated `@types/react` pins have broken web's `next build` type-check. After changing any app's dependencies, check the lockfile still resolves a single copy of shared tooling (`@types/react` currently resolves to exactly one version).

## Schema domains beyond the core

### Subscriptions (`subscriptions.schema.ts`)

Three levels: `subscription_categories` (a group, scoped to listing subcategories) → `subscription_packages` (one fixed tier per group — the `subscription_tier` enum `bronze|silver|gold` — holding the integer limits photos/ads/renews/autoRenews/videos; unique on `(categoryId, tier)`) → `subscription_terms` (price + `discount`/`discountType` + a fixed 3/6/12-month duration; 12 is stored as months and displayed "1 Year"). The former `subscription_plans` level was dropped by migration `0045`; terms outside 3/6/12 months are retired (`is_active = false`), not deleted. `user_subscriptions` snapshots `priceUsd`, `paymentMethod`, `expiresAt`; **status is derived** (`expiresAt < now → expired`), not stored.

**Free plan (2026-10-29):** `free_plan_settings.other_ads` is the account-wide cap on live ads outside held groups; `free_plan_ad_limits` rows are sub-limits inside it (at most N of that pool in one subcategory, else one category), so a cap above the total never binds. A held group keeps its own pool — a Property plan does not lift the car cap. Manage Ads reads active live ads against the free total plus every held group's package, and ads restricted over the allowance live in a **Hidden** tab (their public link 404s). Renewals are pooled per plan and reset on a rolling 30-day window (`listing_renewals`, migration `0046`).

### Reports (`reports.schema.ts`)

`report_reasons` (admin picklist, unique `(targetType, reason)`, `user|listing`); `user_reports` / `listing_reports` (reporter → target, optional `reasonId` with SET NULL, `imagePaths` JSONB on both, `status pending|approved|rejected`, `reviewedById`); `banned_phones` (unique normalized phone + `userId`/`reportId`/`bannedById`, every FK SET NULL so a ban outlives the account); `listings.taken_down_at` marks a moderated removal independently of `status`. Admin lists batch-lookup reporter/target/reviewer + the listing owner via `inArray`.

### Attributes (`attributes.schema.ts`)

One generic `attribute_options` table with a free-form `type` discriminator (varchar 60, **not validated** — a typo silently creates a new set). Unique `(type, slug)`; optional `categoryId` + `subcategoryIds` JSONB (**UUIDs**, not slugs).

**The scoping rule (`forSub` in `apps/web/actions/listings.ts`) — what makes unticking authoritative:** a set where ANY row carries `subcategoryIds` is **managed** and its ticks are the whole truth (an unticked subcategory sees nothing); a set where NO row is linked anywhere is a **global picklist** and returns in full. The rule is decided on the set, not the subcategory's slice — the earlier per-slice version resurrected the whole list when the last row was unticked. Consequence: the first tick anywhere flips a global set to managed for everyone.

Admin CRUD at `/admin/attributes/:type` (`src/attributes/`, standalone module); public reads `GET /attributes/:type` and `GET /attributes?subcategoryId=<uuid>`. Rows carry an optional **`nameKm`** (column `name_km`, added 2026-10-22): the admin create/update DTOs accept it (the Body Types page has a **Khmer Name** field), and the post form's pickers show `nameKm/name` on `/km` (e.g. `សេដាន/Sedan`) while still storing the English `name` as the value. Seeded insert-only (`attributes.seed.ts`, 19 types / ~279 rows, dedupe pre-pass merges shared `other` rows by unioning subcategories). **Images are never seeded** — the one exception is a null-only gap-fill of car body-type icons from bundled assets; the 9 car body-type Khmer names are gap-filled the same way (null-only, so admin edits survive); the 14 car-colour names are seed-owned and refreshed on every seed (colours have no admin UI). `years` is **generated at read time** (currentYear+1 → 1980), not stored; writes to it 400. Admin UI is trimmed to **6** types (`lib/attribute-types.ts`: bodytypes, accessories, jobtypes, types, networks, years(readOnly)) — the sidebar hardcodes its own list, so a new type needs an entry in both. `vehicletypes` is retired (duplicate of bodytypes; rows remain, unread).

## Pipeline workflow

`.pipeline/` tracks features through four phases: `spec.md` (planner) → `changes.md` (coder) → `test-results.md` (tester) → `review.md` (reviewer). Start new features with the planner agent. `tasks/todo.md` is the running ship log — append a dated entry per ship, don't rewrite it.

## Module README convention

"Give me the README for `<module>`" means `src/<module>/README.md` in the fixed shape below; `src/payment/README.md` and `src/chat/README.md` are the canonical examples — re-read both before writing a new one.

1. Title + a one-two sentence purpose.
2. `## Architecture` — an opening subsection named for the module's core design idea (never "Overview"), a table (one row per file, or per DB table for schema-heavy modules), `### Entity map` (`mermaid erDiagram`; skip if the module owns no tables), and a short subsection on which cross-cutting mechanisms it uses — the transactional outbox (`src/outbox/`) and BullMQ queues — and which it deliberately skips, and why.
3. `## Lifecycle, end to end` — real `mermaid sequenceDiagram` flow(s) + a `Key properties this gives us` bullet list.
4. `## Current state` — honest piece-vs-status table (`Done` / `Not started` / partial with caveat).
5. `## Open items` — real findings from reading the code, each with why it matters; carry forward applicable Known-gaps entries.

Process: read every file in the module first; verify claims against code (imports, schema, guards actually applied), not against comments or this file; reuse existing terminology; run prettier on the finished file and confirm mermaid fences survived. If the README contradicts CLAUDE.md, note it under Open items rather than silently rewriting this file.

## Frontend listing-form specs (`spec-detail-*.md`)

`apps/backend/docs/spec-detail-one.md` … `-twelve.md` are the per-category form specs written from the frontend's perspective — the source of truth for each subcategory's `field_schema`. One file per main category (Cars & Vehicles, Phones & Tablets, Computers & Accessories, Electronics & Appliances, Home & Land, Jobs, Services, Fashion & Beauty, Furniture & Decor, Books/Sports & Hobbies, Pets, Foods — all 12 seeded).

**A captain's mock overrides a spec** (the electronics ship added Condition against `spec-detail-four.md`; Home & Land removed `facing` from `apartment-for-rent` against `spec-detail-five.md` — the seed carries inline comments at those spots so they aren't "corrected" back). `field_schema` is the shipped truth; a bare re-read of a spec file can be wrong — check the seed's own comments first.

"Shipping a spec-detail" = translating its forms into `fieldSchema: FieldDef[]` arrays in `src/categories/seeds/categories.seed.ts` (conventions in the Categories i18n section). All 12 are seeded; shared-form families: Jobs (36 subcats), Services (24), Pets (7), Foods (10, both bare `commonListingFields`); the lone mixed family is Books, Sports & Hobbies (only `musical-instruments` has Type + Condition). These are design reference, not runtime docs for the backend — but the web form does consume `field_schema` at runtime.

## TypeScript constraints

- `module: nodenext`, no `"type":"module"` → CJS output. Do **not** add `.js` extensions to relative imports.
- `strict: true` everywhere except `strictPropertyInitialization: false` (NestJS DI fields). `noImplicitAny` + ESLint `no-explicit-any: error` — use typed interfaces or `unknown`. For Supabase use `type AnySupabaseClient = SupabaseClient` + explicit return types on storage methods (avoids TS2742).
- Express 5 wildcards: use `'{*splat}'` in `forRoutes()`, not `'*'`.
- `@nestjs/jwt` `expiresIn` is `ms.StringValue` — cast runtime strings `as unknown as number`.

## Tooling quirks

- **Plain `grep` is a mise shim and breaks** (errors "unknown option '-G'") — use `git grep` or the Grep/Read tools.
- **A PostToolUse hook runs prettier on every edited file** (repo style: double quotes, 2-space). A file that isn't prettier-clean gets rewritten right after the edit, so when batching several edits to the same file, re-Read it after the first edit — later old_strings based on the pre-format text fail with "String to replace not found".
- **CLAUDE.md is deliberately listed in `.prettierignore`** (repo root): prettier's markdown printer corrupts it — it strips the spaces around an inline-code span between two code terms ("`a` adds `b`" → "`a`adds`b`") and escapes `__` inside identifiers. Never run prettier on it and never drop that entry: CI's format gate runs `prettier --check "**/*.{ts,tsx,md}"`, so an un-ignored (or uncommitted) `.prettierignore` turns this file into a red build.

## Environment variables

The backend requires `.env`/`.env.local` inside `apps/backend/` (Zod-validated at boot). Required:

| Var | Constraint |
| --- | ---------- |
| `SUPABASE_URL` | valid URL |
| `SUPABASE_ANON_KEY` | non-empty |
| `SUPABASE_SERVICE_ROLE_KEY` | non-empty |
| `DATABASE_URL` | must start with `postgres` |
| `JWT_SECRET` | ≥ 16 chars |
| `JWT_REFRESH_SECRET` | ≥ 16 chars |

Optional (defaults): `CHAT_FILES_BUCKET=chat-files`, `CHAT_ATTACHMENT_DAILY_BYTES=209715200` (per-user 24 h quota), `PORT=3000`, `DATABASE_POOL_MAX=20` (shared postgres.js pool — raise if traffic queues for connections; see Chat), `JWT_ACCESS_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=30d`, `THROTTLE_TTL=60`, `THROTTLE_LIMIT=100`, `SUPABASE_STORAGE_BUCKET=listings`, `TELEGRAM_BOT_TOKEN`, `FRONTEND_ORIGINS` (comma-separated), `DEV_OTP_TOKEN` (dev only — fixed token accepted for all phone OTPs), `IDEMPOTENCY_TTL_HOURS=24`.

Grouped feature config — `src/config/config.validation.ts` (Zod) is the source of truth:

- **Outbox worker:** `OUTBOX_WORKER_ENABLED=true`, `CONCURRENCY=5`, `POLL_INTERVAL_MS=2000`, `BATCH_SIZE=10`, `MAX_ATTEMPTS=5`, `LEASE_TIMEOUT_SECONDS=60` (must exceed the slowest handler), `BACKOFF_BASE_MS=1000`, `BACKOFF_FACTOR=5`, `BACKOFF_MAX_MS=900000`, `RETENTION_DAYS=7` (≤0 disables).
- **Account purge:** `ACCOUNT_PURGE_ENABLED=true`, `ACCOUNT_PURGE_INTERVAL_MS=21600000` — sweeper that hard-deletes self-deleted accounts after 90 days.
- **BullMQ queue (Redis-protocol server; valkey locally):** `QUEUE_HOST=localhost`, `QUEUE_PORT=6379`, `QUEUE_USERNAME`, `QUEUE_PASSWORD` (blank → undefined), `QUEUE_DB=0`, `QUEUE_TLS=false`, `QUEUE_PREFIX=phsarkhmer`. **Rename migration:** BullMQ does not migrate keys; in-flight `psa:*` / interim `phsar:*` jobs are orphaned. After no old-version instance remains, inspect with `redis-cli --scan --pattern 'psa:*'` (SCAN, not KEYS) and delete.
- **Payment jobs:** `PAYMENT_JOB_ATTEMPTS=3`, `PAYMENT_JOB_BACKOFF_MS=5000`, `PAYMENT_WORKER_CONCURRENCY=5`.
- **ABA PayWay:** `ABA_PAYWAY_API_KEY`, `ABA_PAYWAY_MERCHANT_ID` (optional until called), `ABA_PAYWAY_BASE_URL=https://checkout-sandbox.payway.com.kh`, `ABA_PAYWAY_WEBHOOK_URL` (this backend's public `/api/v1/webhooks/aba-payway`).
- **Bakong:** `BAKONG_BASE_URL=https://api-bakong.nbc.gov.kh`, `BAKONG_API_KEY`, `BAKONG_MERCHANT_TYPE=individual|merchant`, `BAKONG_MERCHANT_ID`, `BAKONG_ACCOUNT_ID`, `BAKONG_MERCHANT_NAME`, `BAKONG_MERCHANT_CITY=Phnom Penh`, `BAKONG_ACQUIRING_BANK`, `BAKONG_QR_EXPIRY_SECONDS=300`, `BAKONG_POLL_INTERVAL_MS=4000`.

`*.env*` is gitignored; the repo installs **no git hooks** — but it HAS CI: `.github/workflows/ci.yml` runs on PRs + `prod` pushes (format:check, `turbo run lint check-types`, a no-autofix `git diff --exit-code` gate, backend unit tests, a `drizzle-kit generate` migration-drift check, build — Node 22), and `deploy.yml` chains it on `prod` → `db:migrate` → Vercel backend deploy (`vercel.json` disables Vercel's own git deploys for `prod`, so nothing ships before CI + migrations). The prettier-on-edit formatting comes from a Claude Code PostToolUse hook, not from git.

**Web env:** `API_URL` (backend base, default `http://localhost:3000/api/v1`) and `SUPABASE_URL` (must match the backend's; `next.config.ts` reads its hostname at build time for `next/image`) — both server-side only. **`NEXT_PUBLIC_WS_URL`** and **`NEXT_PUBLIC_SITE_URL`** are the client-visible exceptions: the chat WebSocket origin read by `hooks/use-chat-ws.ts`; without it the hook falls back to `localhost:3000`, and if the backend is elsewhere the socket "connects" to nothing while `isConnected` flips true — sends are marked "sent" client-side and vanish (REST sends are unaffected). `NEXT_PUBLIC_WS_URL` must mirror `API_URL`'s host; `NEXT_PUBLIC_SITE_URL` is the public site origin used for share links, QR codes and metadata (`lib/site.ts`, default `https://phsarkhmer.com`).

## IDs

Use `crypto.randomUUID()` from Node's `node:crypto`. There is no `uuid` package dependency.

## Known gaps (track as separate tickets)

- **Product Specifications are per model, not per trim/variant.** A car page carries `Years`/`Generation` and the rest as fields; trim-level pages (e.g. BYD Atto 2 45 vs 60) would need a variants concept and a post-form picker change. Phones' per-regional-model band lists are handled by the multi-value template rows (above); a true variants model — per-variant price, availability or a variant selector — is still absent.

- **Five listing categories now require a published spec page.** `cars-for-sale`, `motorcycles-for-sale`, `phones`, `tablets`, `smart-watches` cannot be posted until staff create specs for their models. The `productSpec` key lives in each `field_schema`, which only `db:seed` writes (never run the full seed on prod — apply targeted `UPDATE subcategories SET field_schema = …` statements for the four newly-required forms). The requirement is enforced in the web form only (the DTO stays optional); the picker/resolver caps at 200 published products per family, and the attached spec's family is enforced server-side.

- **Signed uploads are still unvalidated server-side** — no MIME or size check on `/files/sign` uploads, since the bytes never pass through the backend (server-side multipart uploads — avatar, cover, feedback — are capped at 5 MB in multer and limited to raster image types). Ownership is enforced since 2026-10-23: user scopes (`listing`, `avatar`, `cover`, `chat`, `report`, `resume`) sign into `{scope}/{userId}/`, catalog scopes are staff-only, and `DELETE /files` lets non-staff delete only their own folders (`ListingsService.assertPhotosOwned` also proves listing photos are the caller's own uploads). Objects under the old flat `listing/…` paths stay valid on their listings but are never cleaned up by the server.
- **Feedback rows do not own their images.** Deleting a feedback row leaves its storage objects behind; feedback images live in the default `listings` bucket under `feedback/…`, not a private folder.
- **CI covers the trees, not every surface.** CI (2026-10-06) gates PRs and `prod`; but stats, users CRUD, subscriptions and attributes have zero unit coverage, there are no admin-surface tests, and **`apps/mobile` has no type gate at all** (`expo lint` only — run `pnpm --filter phsarkhmer exec tsc --noEmit` by hand). Backend suite: **70 suites / 933 tests** (verified 2026-10-24 after the prod merge; reports and feedback covered).
- **`apps/mobile` is a mock-data prototype.** No API client anywhere (no fetch/axios, no base-URL env), `AuthContext` ships a hardcoded `DEFAULT_USER` with a state-only `login()`, screens read `constants/data/*`. Wiring it up is unstarted work.
- **Web ships 2 locales, the backend stores 3** (`i18n/routing.ts` = `en/km` vs `localeEnum` = `en/km/zh`) — removed `zh/ko/id/vi` URLs 404; `preferredLanguage` accepts `en/km`; `zh` remains a valid translation-storage locale.
- **Category translations carry `en` + `km`; `zh` is absent** — 12 category + 146 subcategory `km` names live inline in `categories.seed.ts` (hand-written via `edit-translate/categories.km.tsv`, 2026-10-21; the seed runner already loops `en/km/zh`). Field-schema `label` objects remain `en`-only. Admin category/subcategory create/update accept and return `nameKm` (empty string clears the km row), and the dashboard forms expose a "Khmer name" input.
- **Frontend UI translation covers marketplace + chrome + settings + /me + the sell flow + `/insight` + public profiles + the CV flow** — `apps/web/messages` has 24 namespaces / 1113 keys per locale (category pages, filters, cards, `/all-ads`, listing detail, nav/footer, notifications, share/report, the full `/settings` surface, the `/me` account surface, the post flow (category chooser + the real `ListingPostForm`/`ImageUpload`), the account insight summary, the public profile header/tabs/feed bar/three-dot menu, and the full resume flow: start card, finished preview/editor, and all eight section dialogs + the location/date pickers). Auth, feedback, the legacy mock `DynamicForm` fallback (admin-created subcategories only), legal/help pages and admin `/wanderer` remain English. `lib/api/categories.ts` still fetches brands/models with `Accept-Language: "en"` (proper nouns, no km data); attribute options now carry `nameKm` (body types + car colours seeded), so those pickers show Khmer, while the stored value stays the English `name`. Locations return `name` + `nameKm` and the web localizes them; the km listing detail resolves its geo ids to `nameKm` and maps spec values through `nameKm` (plus static tax/engine/transmission maps). Feed cards batch-resolve the page's province/district ids once (never per card) and card times switch to 24-hour on km; the likes/saved reaction cards still use the stored English location because that endpoint does not go through `getListingsFeed`. Backend error strings are proxied as-is. Client date labels use `lib/locale-labels.ts` (explicit en/km month/weekday names) because Khmer ICU data is not guaranteed.
- **Latent spec-vs-managed-set name divergences (all inert while the set is managed, the `bathrooms` hazard shape):** Fashion & Beauty `type` options (`Men's Accessories`/`Baby & Kids Clothing` in the spec vs `Men Accessories`/`Kid Clothing` in the rows and mock — rows win); Furniture `type` options (spec plurals vs rows' singulars — rows win); the shared `other` row reads `Other - ផ្សេងៗ` app-wide vs plain `Other` in specs (not fixable per-family); jobs' inline job-type list (`Internship`/`Other` vs rows `Internships`/`Other-Jobs`) and `experiences` (rows `2 Year+` vs inline `2 Years+`). Unlinking every row would swap each form onto names no Browse grid can filter — deliberately left.
- **A typeless subcategory gets a dead grid if an admin ticks any `types` row for it.** 29 opted-in forms declare no `type` (Home & Land's 3, fashion's `beauty-and-healthcare-products`, furniture's 8, all Pets + Foods); all have zero ticks today. Ticking one grows a "Type" grid whose click resolves to `undefined` → legacy `bodyType` path → empty feed, no message. The guard is configuration: never tick `types` for those.
- **`photos` is the one schema key with no render gate** (`ImageUpload` renders unconditionally at max 8). Inert — all 146 declare photos — but check before opting in a form that doesn't.
- **A subcategory created through the admin UI still has no working post form.** `CreateSubcategoryDto`/`UpdateSubcategoryDto` carry no `field_schema` and the seed is its only writer, so such a subcategory gets a NULL schema and lands on the deliberately-unwired mock `DynamicForm` — it cannot publish at all. That makes `DynamicForm` + `EMPTY_OPTION_LISTS` **load-bearing, not dead code**; a real fix is a product decision. The mock data modules were deleted on 2026-10-30 (`lib/post-ad.ts`, `lib/categories.ts`, `lib/location.ts`, `lib/data.ts`, `lib/users.ts`, `lib/subcategoryGroups.ts`, `PostForm.tsx`, and the mock `posts`/`users` arrays); `/sell` now redirects to `/post`, and legacy numeric `-adid-` URLs 404.
- **Test/E2E debris has no cleanup path.** `listings.seed.ts` deletes junk by an exact-title list (7 cars-era strings), so later families' verification listings survive re-seeds (15 were live in the dev DB on 2026-09-28), and `DEMO_LISTINGS` covers no pets/foods/services/books rows — deleting the debris would empty those feeds. Options left open: switch `JUNK_TITLES` to an `ILIKE '%E2E%'` pattern, and add demo rows for the four families.
- **Idempotency completed-row hash reuse** — same key + different body returns the cached response instead of 422.
- **Legacy sessions without a `sid` cannot be revoked per device** until they refresh/re-login; admin and social/Telegram logins carry no device id. An already-open chat socket is checked on every send and closed on the next one, but an idle revoked socket can still receive pushes until it sends or reconnects.
- **Follower lists need a login, and `follow.created` is not transactional with the edge.** (1) The JWT requirement is what buys per-row `isFollowing` without an N+1. (2) `followUser` inserts, then notifies out-of-transaction: a notification failure 500s after the follow commits (self-healing — the `.returning()` guard prevents duplicates — so the worst case is a lost notification, never a wrong one).
- **Anything touching the migration watermark: check it first.** drizzle-orm 0.36.4's migrator compares only the *newest* `created_at` in `drizzle.__drizzle_migrations` against each journal `when` (no per-hash check), so renumbered or older-stamped unapplied files are **silently skipped**. It bit the dev DB once (`0023`–`0026` re-run risk, repaired 2026-09-28, backup `drizzle.__drizzle_migrations_backup_20260928`) and the renumbering has happened again since — simulate before trusting `db:migrate` on an old DB.
- **Mock profile URLs no longer resolve.** `/[username]` and `/[username]/about` look the handle up against real accounts (`GET /users/by-username/:username`) and `notFound()` otherwise — old demo handles 404 by design. `lib/user.ts` is still live (its `User` type is the profile render contract; `toProfileUser` adapts onto it).
- **Delete-account is a 90-day recovery window, not an instant wipe (2026-10-05).** `DELETE /users/me` (body `{password}`, bcrypt-checked) soft-deletes but deliberately keeps `primaryPhone`/`user_phones` (unlike admin deletion) — those are what the password-login reactivation path matches on. `AccountPurgeService` hard-deletes after the window (`ACCOUNT_RETENTION_DAYS = 90`, shared with AuthService on purpose); all FKs cascade.
- **Two category names don't match their i18n keys** — the DB says "Home & Land" (keys: "House & Land") and "Books & Sports & Hobbies" (keys: "Books, Sports & Hobbies"), so those Browse-strip entries render untranslated in every locale. The direction (rename the key vs the DB value) was never decided; the 2026-09-22 mock favours renaming the DB value. ("Phones & Tablets" was the same bug, fixed 2026-09-22.)
- **Geography names are en/km** — `GET /locations/...` now returns `name` + `nameKm` (additive, 2026-10-21); the web shows `nameKm` on `/km` and sorts by it, while `/en` is unchanged. No `name_zh`; villages deliberately unmodelled; the data file is a checked-in snapshot.
- **`PublicUser` over-exposes cross-user fields** (`GET /users/:id` returns `Omit<UserRow,'passwordHash'>` — includes `deletedAt`, verification timestamps). Narrow to an allow-list.
- **Attribute `:type` param is unvalidated** — any string silently creates a new set (`varchar(60)`); consider an allowlist.
- **No push notifications for chat** (no FCM/APNs — a backgrounded app catches up on its next poll); **legacy chat images are public-bucket URLs** (no migration); **WS + REST rate limiting is per-instance** (`@Throttle` uses in-memory storage; needs a shared counter before multi-instance abuse).
- **Inline `field_schema` duplication** — ~10 forms are byte-identical to `commonListingFields` yet re-inline all 11 fields; a one-time systemic DRY pass, never per-ship.
- **`super_admin` vs `admin`: a tier split, plus account-management policy (2026-10-26).** The guard matches roles literally, so `@Roles('admin')` excludes a `super_admin`; super_admin's mandate is stats, reports, team, feedback and advertisements, and the sidebar mirrors that through each menu item's `roles` field. Every admin user mutation goes through `assertCanManageUser` (`admin/admin-user-policy.ts`, via `AdminService.authorizeManage`): only `super_admin` may grant staff roles or edit/suspend/delete an `admin`/`super_admin` account, nobody may delete, demote or suspend themselves, and the last active super_admin can never be removed (counted under a row lock). The Team page (`/wanderer/dashboard/team`) is super_admin-only; beyond role assignment, the guards treat `admin` and `super_admin` identically. The Users page form still offers `super_admin` to regular admins (backend 403s; hide the option later).
- **User-facing surfaces are real data.** Real: the `/me` header, home Browse-By-Category + Latest Ads + the engagement-ranked Trending strip (replaced the mock Top Ads on 2026-10-26), every category/subcategory feed + browse bar, listing detail, the post form (all 146), `/all-ads` (2026-09-28), `/search`, `/notifications`, `/settings/*` (`getSettingsUser`), `/me/{likes,saved,followers,following}`. Real since 2026-10-16: `/me/{applied-jobs,job-applications}` (job applications) and `/me/resume`. Real since 2026-10-17: the report dialogs (listing detail, feed card kebab, seller profile; reasons + photos + submit) and the admin report queues (with take-down). Real since 2026-10-19: `/insight` (account-wide listing interaction events). Real since 2026-10-20: `/me/about` (`getSettingsUser` + `GET /users/me/phones` + `resolvePlaceSelection`; the `@handle` links to the public profile). Real since 2026-10-21: `/feedback` (public submission) and the admin Feedback queue. Real since 2026-10-23 (merged from prod): `/me/subscriptions`, the premium-account/checkout flow, and `Manage-Ads` (real plan/count data; `/me/membership` is now a redirect). Still mock: none — `/me/billing-addresses` is real since 2026-10-27, and the mock data modules were deleted (2026-10-30 cleanup). Phase C (profile surfaces) is the remaining user-account work.
- **Catalog images have no Storage backing** (2026-09-10 audit: 154 rows point at bundled `/sub-img` files, 152 at objects that are gone). All render as the no-image state by design; **captain's decision: leave it imageless** — do not re-add bundled paths or static fallbacks.
- **Specs-grid brand links are best-effort** (`slugify(attribute name)` can diverge from `brands.slug`; model links only highlight). Carrier icons cover 4 carriers (Qube/unknown → letter badge).
- **Schema-driven More Filters labels are English-only.** The dialog renders one select per `field_schema` `select` field (storage, screen size, RAM, CPU, job type, …) and AND-s them through the feed's `attrs` param; known keys use the `Specs.attributes` translations, the rest fall back to the schema's English label, and inline option names have no Khmer variants. The filtering itself works on both locales.
- **`generateUniqueUsername` race** — check-then-insert with no 23505 retry; concurrent same-name creates can 500.
- **`phoneVerifiedAt` is only stamped by the OTP change-phone flow** (`users.service.ts`), not by register/OTP login, so most accounts read "Not Verified" on `/me/about` and the public profile; a soft-deleted user keeps its globally-unique `user_phones` row, so a re-registered user can have `primaryPhone` but no `user_phones` row (the About page falls back to it).
- **Moderation is prod's model with v1's phone ban layered on (2026-10-24 merge).** Staff take ads down via `/admin/listings/:id/remove` or by approving a listing report: `listings.moderatedAt`/`moderatedById`/`moderationReason`, status `deleted`, owner blocked from edit/publish (`LISTING_REMOVED_BY_ADMIN`), public `GET /listings/:id` 404s; restore re-derives the status. Users file reports via `/reports/listings|users` (one pending report per reporter+target). v1's `banned_phones` survives: approving a **user** report inserts every phone on the account and the auth/users entry points reject a banned number (`PHONE_BANNED`); there is still no unban endpoint (a manual `banned_phones` delete is the only lift). Evidence uploads under `report/{userId}/` in the default bucket (unguessable, not private). Not yet: the owner's My Ads page does not explain a removal; Manage Advertisement Ads and an admin Payments page are not built.
- **Username login is case-sensitive** (generated usernames are lowercase); `UpdateProfileDto` names have no `@MaxLength` (22001 → 500 on overflow).
- **`src/tenant/` is a design doc, not code** — a proposed `tenants`/`tenant_members` schema for `payment_transactions.tenantId` (currently a bare UUID) and possibly `user_subscriptions`; no schema file, migration or export exists.
