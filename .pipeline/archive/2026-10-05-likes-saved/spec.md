# Likes & Saved — make the like button and save work

## Context

Captain request (2026-10-05): "make the like button and save work."

Likes and Saved are the last mock-backed user-facing surfaces. The account menu
reaches `/me/likes` and `/me/saved` with real links (2026-10-02 ship, "The
account menu's items now go somewhere"), but the controls behind them never
persisted anything — the ship log closed with "the `/me/*` pages themselves are
still mock-backed ... it does not make them real." This change makes them real:
real like/save edges, real toggles on every surface that shows the control, and
real list pages.

This is a coder-stage spec: it is intentionally concrete enough that the edits
follow directly from it. Every existing-code claim cites `file:line`.

## Current state (evidence)

Web — all likes/saves are client-side mock, no backend call anywhere:

- `apps/web/components/ads/GridCardPost.tsx:20` — `isLiked` useState; the heart
  (`:140-171`) toggles local state and fires an `setTimeout` fake toast.
- `apps/web/components/ads/ListCardPost.tsx:41-42` — `isLiked` + `isSaved`
  useState; heart (`:233-263`) and the ⋮ menu Save toggle (`:120-152`) do the
  same fake-toast dance.
- `apps/web/components/Card/ThreeDotPost.tsx:25` — `isSaved` useState; Save /
  Unsave toggle at `:63-90` (this menu renders on GridCardPost cards,
  `GridCardPost.tsx:76`).
- `apps/web/components/post/ThreeButton.tsx:18-24` — the detail page's Save
  button has **no `onClick` at all**; Report (`:25-34`) and Share (`:35-41`)
  already work. Rendered from `Post-Detail.tsx:330`.
- `apps/web/components/post/PostImage.tsx:44-60, 87-102` — the gallery overlay's
  "0 Likes" control is inert (no handler) though styled as a button.
- `apps/web/components/profile/Liked-Ads.tsx`, `Saved-Ads.tsx` — static
  "No Result!" empty states only; wrapped by
  `apps/web/app/[locale]/(user)/me/likes/page.tsx` and `me/saved/page.tsx`.
- The menu links exist: `apps/web/components/web/SocialBar.tsx:140-161`.

Backend — no likes/saves code exists at all (grep for `user_likes`,
`listing_likes`, `saves` under `apps/backend/src` returns nothing).

House patterns to mirror (all verified):

- `user_follows` edge table: `apps/backend/src/db/schema/users.schema.ts:206-233`
  — uuid PK, both FKs `onDelete: 'cascade'`, unique pair index, reverse index,
  `createdAt`. The cascade note there is load-bearing: `AccountPurgeService`
  hard-deletes users and depends on every inbound FK taking its rows along.
- Toggle service idioms: `apps/backend/src/users/users.service.ts:564-639` —
  idempotent insert via `onConflictDoNothing(...).returning(...)`, delete that
  never 404s on a missing edge ("the toggle's end state is the whole contract"),
  `count()` for counts.
- Offset pagination: `users.service.ts:716-760` (follow lists) and
  `listings.service.ts:338-402` (`findMine`) — `count(*)` + page/pageSize,
  meta `{ nextCursor: null, hasMore, limit, total, page, pageSize }`.
- Listing row shape the web adapts with `toCardPost`
  (`apps/web/lib/api/categories.ts:401-436`): `ListingWithPhotos` rows
  (`listings.service.ts:36-46`) with `photos: ListingPhotoRow[]`; the feed's
  batch photo load is `batchLoadPhotos` (`listings.service.ts:329-333`).
- Detail row: `listings.service.ts:214-239` (`findById`) — left-joins the
  owner's username, **no status filter** (serves any status, incl. `deleted`).
- Server-rendered initial state + optimistic toggle + sign-in bounce:
  `apps/web/components/profile/FollowButton.tsx` and `actions/follows.ts`
  (`userServerFetch`, `{ success, error? }` mutation shape).
- `(user)/layout.tsx` already resolves the viewer server-side via
  `getUserProfile()` (`actions/user.ts:48-63`) — the natural host for the
  one-shot reaction-state read.
- The pipeline's previous run archived at `.pipeline/archive/2026-09-24/`.

## Goal

1. A signed-in user can like / unlike a listing from every surface that shows
   the control, and save / unsave likewise; state persists across reloads.
2. `/me/likes` and `/me/saved` list the real liked / saved listings, newest
   first, paginated, with today's empty states kept for the empty case.
3. The listing detail's "N Likes" control is live: correct count, toggles the
   like.
4. Anonymous visitors get the sign-in bounce (toast + `/login`), no other
   change.

## Non-goals (explicitly excluded, captain-approved)

- No notification to the seller on like/save (candidate follow-up; note it).
- No admin-dashboard surfaces for likes/saves.
- No counts shown anywhere except the detail's control (cards keep their
  count-less design).
- No changes to follow/block/chat/subscription semantics.

## Design decisions

1. **Two edge tables, mirroring the follow graph exactly** — `listing_likes`
   and `listing_saves`. One table per relation matches `user_follows` /
   `user_blocks`; a shared table with a `kind` discriminator would be a new
   pattern for no gain. Both FKs cascade so account purge and listing hard
   delete stay correct.
2. **Idempotent both ways, delete never 404s.** `POST` rides
   `onConflictDoNothing`; `DELETE` on a missing edge returns the same
   `{ liked: false }` the toggle's end state means — a double-tap must land on
   "not liked", never an error toast (the unfollow contract,
   `users.service.ts:600-618`).
3. **Visibility rule.** Toggling requires only that the listing row exists
   (404 otherwise) — deliberately mirroring `findById`
   (`listings.service.ts:214-239`), which serves any status, so the control is
   never present-but-refused on a detail page. The two list queries filter
   `status != 'deleted'` (a removed ad must not appear in "my likes"); the
   id-set call is unfiltered (it only lights up buttons for rendered cards).
4. **`likeCount` is computed, never denormalized.** A `count()` on the indexed
   `listing_id`; no counter column to drift (Phsar has no counter columns;
   the follow counts are computed the same way, `users.service.ts:641-656`).
5. **One batched hydration call.** `GET /users/me/reactions` returns both id
   arrays; cards read a client context seeded server-side. This is the
   batch-lookup pattern (no N+1, no per-card request) and keeps the initial
   state truthful on first paint — the same "server-rendered state,
   authoritative until the first click" contract FollowButton documents.
6. **Own listings may be liked/saved.** No self-check: the follow feature's
   self-check exists so nobody follows themselves, but the hearts render on
   every card including your own ads, and a refusal rule would need UI to hide
   the control. Harmless; documented in the spec tests.

## Backend plan

### Data model — new `apps/backend/src/db/schema/reactions.schema.ts`

```ts
export const listingLikes = pgTable(
  "listing_likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("listing_likes_pair_uq").on(t.userId, t.listingId),
    index("listing_likes_listing_id_idx").on(t.listingId),
  ],
);
```

`listing_saves` is identical (`listing_saves_pair_uq`,
`listing_saves_listing_id_idx`). Types `ListingLikeRow` / `NewListingLike` /
`ListingSaveRow` / `NewListingSave`. Re-export from `db/schema/index.ts`
(one line, alongside the other domains). Migration: `db:generate` → the next
`0028_*` file.

### API contract (new `apps/backend/src/reactions/`)

All routes require JWT (global guard; nothing `@Public()`). Envelope/timing
unchanged. Module registered in `app.module.ts`; two controllers in the module
mirroring the attributes module's split:

**`ListingReactionsController` — `@Controller('listings')`**

| Route                    | Returns                               |
| ------------------------ | ------------------------------------- |
| `POST :listingId/like`   | `{ liked: true, likeCount: number }`  |
| `DELETE :listingId/like` | `{ liked: false, likeCount: number }` |
| `POST :listingId/save`   | `{ saved: true }`                     |
| `DELETE :listingId/save` | `{ saved: false }`                    |

- `:listingId` via `ParseUUIDPipe` (house style, `users.controller.ts:221-237`).
- 404 `Listing not found` when the listing row does not exist (both verbs,
  both entities). No other rejections.
- `likeCount` is the count **after** the write, so the button's count is
  driven by the response and never needs a refetch.

**`MeReactionsController` — `@Controller('users')`**

| Route              | Returns                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `GET me/likes`     | `PaginatedResponse<ListingWithPhotos>` — liked listings, newest edge first |
| `GET me/saves`     | same, for saves                                                            |
| `GET me/reactions` | `{ liked: string[], saved: string[] }` — batched card hydration            |

- Lists paginate with `ListReactionsDto` (`page` / `pageSize`, mirroring
  `dto/list-follows.dto.ts`), ordered `desc(edge.createdAt), desc(edge.id)`
  (id tie-break so page boundaries never repeat/skip), `status != 'deleted'`,
  rows in the exact feed shape (photos batch-loaded) so the web adapts them
  with the existing `toCardPost`.
- The word "me" routes are three-segment paths; they cannot collide with
  `UsersController`'s two-segment `me/*` or three-segment `:id/*` routes.

**Service** (`ReactionsService`): `likeListing(userId, listingId)`,
`unlikeListing`, `saveListing`, `unsaveListing`, `getReactionIds(userId)`,
`listLikedListings(userId, query)`, `listSavedListings(userId, query)`,
`countLikes(listingId)`. A shared private `assertListingExists(listingId)`
does the 404 check once.

**Detail count.** `ListingsService.findById` gains `likeCount` on its return
(`ListingWithPhotos` gets an optional `likeCount?: number`): the module injects
`ReactionsService` (ListingsModule imports ReactionsModule, which exports the
service — no cycle: the reactions module never imports listings). Computed via
`countLikes` in the existing query path.

### Backend files

- **New:** `src/db/schema/reactions.schema.ts`, `src/reactions/reactions.module.ts`,
  `src/reactions/reactions.service.ts`, `src/reactions/reactions.controller.ts`
  (both controllers, or split into two files if cleaner),
  `src/reactions/dto/list-reactions.dto.ts`,
  `src/reactions/reactions.service.spec.ts`,
  `drizzle/migrations/0028_*.sql` (generated).
- **Edit:** `src/db/schema/index.ts` (+1 export), `src/app.module.ts`
  (import + register), `src/listings/listings.module.ts` (import
  ReactionsModule), `src/listings/listings.service.ts` (inject
  ReactionsService; `likeCount` in `findById`).

## Web plan

### State flow

```
(user)/layout.tsx (server)
  ├─ getUserProfile() → viewer (already there)
  ├─ viewer ? getMyReactionIds() : { liked: [], saved: [] }   (fail-soft to empty)
  └─ <ReactionsProvider signedIn initialLiked initialSaved> {children} </...>
        └── context: isLiked(id) / isSaved(id) / toggleLike(id) / toggleSave(id)
              ├─ optimistic flip + rollback on failure, disabled while pending
              ├─ signed-out click → toast "Sign in to like/save" + router.push("/login")
              └─ failures: toast.error (house FollowButton behavior)
```

Cards and buttons consume the context — no per-card fetches, no prop
threading through pages.

### Web files

- **New** `apps/web/lib/api/reactions.ts` (server-only): `getMyReactionIds()`
  → `{ liked: string[]; saved: string[] }` (fail-soft empty),
  `getMyReactionPage(side, page, pageSize)` → `{ items: Post[]; total; hasMore }`
  via `userServerFetch` + `toCardPost`.
- **New** `apps/web/actions/reactions.ts` (`"use server"`): `likeListing`,
  `unlikeListing`, `saveListing`, `unsaveListing` → `{ success, error?, liked?,
saved?, likeCount? }`; `loadMyReactionPage(side, page)` for the panels.
  Mirrors `actions/follows.ts` (ApiError → message, no revalidatePath — the
  caller owns refresh).
- **New** `apps/web/components/reactions/reactions-provider.tsx` (client):
  context + `useReactions()` hook; optimistic state seeded from props; exposes
  `signedIn` so controls can bounce.
- **Edit** `app/[locale]/(user)/layout.tsx`: fetch ids when the viewer exists;
  wrap `{children}`.
- **Edit** `components/ads/GridCardPost.tsx`: heart reads `isLiked(post.postId)`;
  click → `toggleLike` (keep styling/bad behaviors; no fake toast).
- **Edit** `components/ads/ListCardPost.tsx`: heart + ⋮ Save read/toggle via
  context.
- **Edit** `components/Card/ThreeDotPost.tsx`: Save/Unsave reads/toggles via
  context (its label already follows the pressed state).
- **Edit** `components/post/ThreeButton.tsx`: Save button gets the real
  toggle; `disabled` while pending.
- **Edit** `components/post/PostImage.tsx`: "N Likes" reads the count
  (initial from the listing payload, updated from the toggle response) and
  toggles the like; heart fills when liked.
- **Edit** `components/post/Post-Detail.tsx` (+ `lib/api/categories.ts` +
  `lib/posts.ts`): carry `likeCount` from `BackendListing` into the detail
  render (`RealDetailData.listing`); `Post` gains optional `likeCount`.
- **Edit** `components/profile/Liked-Ads.tsx` / `Saved-Ads.tsx`: accept items;
  render the listing grid (reuse `GridCardPost`; the grid treatment the other
  real feeds use) + a "Load more" affordance mirroring `FollowListPanel`'s
  pagination; **keep the existing empty-state markup exactly** as the empty
  branch.
- **Edit** `app/[locale]/(user)/me/likes/page.tsx` / `me/saved/page.tsx`:
  fetch page 1 server-side (`getMyReactionPage`), pass to the component.

Strings stay hardcoded English like the rest of these components
("Save", "Unsave", "Sign in to like", …) — no i18n keys exist for this family
and none are added.

## Edge cases

- **Double-tap / retry:** POST and DELETE are idempotent; a failed toggle
  rolls the optimistic state back and toasts.
- **Anonymous:** controls render; click → toast + `/login` bounce (provider's
  `signedIn`).
- **Deleted listing:** toggles still resolve if the row exists (mirrors the
  detail page serving any status); lists hide `deleted`; ids/count unfiltered.
- **Own listings:** likable (documented above).
- **Stale client state:** the provider is authoritative within a page session;
  server-rendered lists/counts refresh on navigation/reload. No cross-tab
  sync (out of scope).
- **Expired/draft listings reached by URL:** toggle works; they appear in
  lists (not `deleted`).
- **A like on a listing whose owner is soft-deleted:** unaffected (no user
  join involved in cards you like).

## Testing strategy

- **New unit suite** `src/reactions/reactions.service.spec.ts` (mirror
  `users.service.spec.ts` style): like is idempotent (double insert → one
  row, one count); unlike on a missing edge does not throw; toggle on a
  missing listing 404s; `getReactionIds` returns both arrays; list queries
  paginate (page boundaries with the id tie-break) and drop `deleted`
  listings; `countLikes` counts edges.
- **Gates:** `pnpm --filter backend build`, `lint`, `test`;
  `pnpm --filter web build` (the type gate), `lint`.
- **Browser (CDP recipe in CLAUDE.md + memory):** signed in as a test user —
  like from a grid card (heart fills, survives reload); unlike (empties);
  save from the ⋮ menu and from the detail row; `/me/saved` lists it; remove
  it from `/me/saved`'s card and the list drops it; detail "N Likes" counts
  and toggles; signed-out click bounces to `/login`.

## Migration notes

`pnpm --filter backend db:generate` → `0028_*` (drizzle-kit, existing
workflow). Before `db:migrate`, check the dev DB's ledger watermark — the
2026-09-28 repair (`__drizzle_migrations_backup_20260928`) exists because the
migrator compares only the newest `created_at`; renumbered branch-era
migrations can re-run. Apply, then confirm `listing_likes` / `listing_saves`
exist before browser verification.

## Open questions

None.

## Out of scope / noted for later

- Like/save notifications to the seller (the follow feature's
  `follow.created` is the shape it would take).
- Admin dashboard views/counts for likes/saves.
- Like/save counts on cards (design shows none).
- Cross-tab realtime sync of reaction state.
