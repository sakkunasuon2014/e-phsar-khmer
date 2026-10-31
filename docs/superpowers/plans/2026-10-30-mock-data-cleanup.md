# Mock Data Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all mock catalog/user/location data from `apps/web`, delete the dead mock code, and cut the mock payload out of the client bundle without changing behavior on real data.

**Architecture:** The UI already runs on backend data; the mock modules survive only as fallback lookups in four live components, two legacy numeric-id detail routes, the orphan `/sell` form, and dead code. The plan removes the fallbacks, retires the legacy routes, deletes the modules while keeping the `Post` and `User` types, and verifies with the build gate plus browser smoke checks.

**Tech Stack:** Next.js 16 App Router, TypeScript, Turbopack, next-intl. `apps/web` has no test framework, so `next build` is the type gate and CDP browser checks are the behavioral acceptance.

**Spec:** The 2026-10-30 mock-data audit (no separate spec file); this plan is the authority.

## Global Constraints

- No new dependencies; no backend or API changes; do not touch `apps/mobile`.
- Preserve behavior on real data; the only intentional behavior changes are the legacy numeric ad URLs and `/sell` (decisions D1/D2 below).
- Keep `DynamicForm` in `/post` — the admin-created-subcategory fallback does not use the mock modules (its options come from `actions/post-categories.ts`).
- Do not commit: the captain's standing rule forbids proactive commits. Changes stay in the working tree; per-task review uses working-tree snapshots.
- Gates after every task: `pnpm --filter web lint` and `pnpm --filter web build`.
- If updating `CLAUDE.md`: never run prettier on it; edit via Bash + python3 (it is in `.prettierignore` for a reason).

## Decisions (ruled at execution start)

- **D1 — Legacy numeric ad URLs** (`/en/123-adid-123`): **404**. The content is fabricated and has no DB row; this mirrors the existing "mock profile URLs 404 by design" precedent.
- **D2 — `/sell`**: **locale-aware redirect to `/post`**, so old links keep working while the mock form is deleted.

## Review Focus

1. A real feed card whose listing has no location must render cleanly (no stray separator or broken fallback).
2. An old numeric ad URL must 404, not crash or render mock content.
3. The public-profile route shares `[slug]/page.tsx` with ad detail — profiles must still render after the `-adid-` branch changes.
4. The publish flow must still work for both seeded subcategories (real form) and admin-created subcategories (legacy `DynamicForm`), and `/sell` must land on `/post` in the right locale.
5. Khmer locale (`/km`) must keep working for feed cards, detail and the redirect.

---

## Task 1: Delete verified-dead mock modules and components

**Files:**

- Delete: `apps/web/lib/post-ad.ts` (6,542 lines)
- Delete: `apps/web/lib/users.ts` (152 lines)
- Delete: `apps/web/lib/subcategoryGroups.ts` (114 lines)
- Delete: `apps/web/components/ads/AdsPhoto.tsx`
- Delete: `apps/web/components/Card/TabsCard.tsx`
- Delete: `apps/web/components/ads/ListAd.tsx`
- Delete: `apps/web/components/ads/NormalAd.tsx`
- Delete: `apps/web/components/all-ads/AllAdsHeader.tsx`

**Interfaces:** Produces a smaller tree; nothing imports these files (verified).

- [ ] **Step 1: Re-verify zero references**

```bash
git grep -n "post-ad" -- apps/web            # expect only comments
git grep -nE 'from "@/lib/(users|subcategoryGroups)"' -- apps/web   # expect none
git grep -n "AdsPhoto\|TabsCard\|ListAd\|NormalAd\|AllAdsHeader" -- apps/web
# expect each hit to be inside its own file only
```

- [ ] **Step 2: Capture the baseline build**

```bash
pnpm --filter web build | tee /tmp/web-build-baseline.txt
```

Record "First Load JS" for `/`, `/[locale]`, `/[locale]/all-ads`, `/[locale]/search`, the category and post routes.

- [ ] **Step 3: Delete the files**

```bash
git rm apps/web/lib/post-ad.ts apps/web/lib/users.ts apps/web/lib/subcategoryGroups.ts \
  apps/web/components/ads/AdsPhoto.tsx apps/web/components/Card/TabsCard.tsx \
  apps/web/components/ads/ListAd.tsx apps/web/components/ads/NormalAd.tsx \
  apps/web/components/all-ads/AllAdsHeader.tsx
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: both pass; route table unchanged (these files were never bundled).

- [ ] **Step 5: Commit**

Skip — the captain's standing rule forbids proactive commits. Leave the deletions in the working tree.

---

## Task 2: Remove mock lookups from real feed cards

**Files:**

- Modify: `apps/web/components/ads/GridCardPost.tsx:9,37-38,130-133`
- Modify: `apps/web/components/Card/ThreeDotPost.tsx:11-12,44-45`

**Interfaces:**

- Consumes: `Post` from `@/lib/posts` (type only); real feed always sets `post.location` and `post.sellerUsername`.
- Produces: same component props (`{ post: Post }`), no mock imports.

- [ ] **Step 1: GridCardPost**

Remove the `@/lib/data` import; delete `const province = ...` and `const district = ...`; change the location span body to `{post.location}`. Convert `import { Post }` to `import type { Post }`.

- [ ] **Step 2: ThreeDotPost**

Remove the `@/lib/data` import and its comment; set `const username = post.sellerUsername ?? null;`. Convert the `Post` import to `import type`.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: pass, no unresolved imports.

- [ ] **Step 4: Browser smoke (home, category, all-ads)**

Launch Chromium per the repo CDP recipe; check ~10 s hydration; assert cards show title, price, time, location text; the kebab shows "View Profile" for a real listing.

- [ ] **Step 5: Commit**

Skip — no proactive commits.

---

## Task 3: Retire the legacy mock listing-detail path

**Files:**

- Modify: `apps/web/components/post/Post-Detail.tsx`
- Modify: `apps/web/components/post/Profile-Sidebar.tsx:8,23-47`
- Modify: `apps/web/app/[locale]/(user)/[slug]/page.tsx`
- Modify: `apps/web/app/[locale]/(user)/post/[slug]/page.tsx`

**Interfaces:**

- `PostDetail({ real, viewerId, sellerFollowing, jobApply, banners })` — `real: RealDetailData` is now **required**; the `id` prop is removed (its only use was the mock lookup).
- `ProfileSidebar({ userId, user, ... })` — `user: User` is now **required**.

- [ ] **Step 1: Post-Detail becomes real-only**

- Delete every import from `@/lib/data` (`getPostById`, `getUserById`, `getProvinceById`, `getDistrictById`, `getCategoryById`, `getSubCategoryById`, `getBrandById`, `getModelById`).
- Delete `isReal` and every `isReal ? … : …` ternary: `post = toPostView(real.listing)`, `user = real.seller`, `cate/subcate/brand/model = real.*`, `product = real.product`, `displayId`, `fullLocation`, `addressLine`, `locationLine`, `lat/lng`, `listingContext`.
- Keep `if (!user) return null;` as a guard; drop the `notFound()` mock fallback and its import if unused.
- Update the `RealDetailData` doc comment (no longer "real and mock posts").

- [ ] **Step 2: Profile-Sidebar**

Remove the `getUserById` import; make `user: User` required; use the prop directly.

- [ ] **Step 3: Both route pages**

- In `generateMetadata` of each: delete the `posts` import and the mock lookup; for `-adid-` slugs whose id is not a UUID return `{ title: "404 Not found" }`.
- In the page body: replace the non-UUID `return <PostDetail id=... />` with `notFound()` (D1). Keep the UUID branch; drop the now-unused `id` prop.

- [ ] **Step 4: Verify build**

Run: `pnpm --filter web lint && pnpm --filter web build`

- [ ] **Step 5: Browser smoke**

- Real listing detail: gallery, specs grid, seller card, phone/email reveal, like/share.
- Job listing: Apply control still appears for a signed-in non-owner.
- Old numeric URL (pick an id from `lib/posts.ts` before deletion) → 404 page.
- Public profile `/{locale}/<username>` → header + tabs still render.

- [ ] **Step 6: Commit**

Skip — no proactive commits.

---

## Task 4: Retire `/sell` and delete the mock data modules

**Files:**

- Modify: `apps/web/app/[locale]/(user)/sell/page.tsx` (replace with redirect)
- Delete: `apps/web/components/post/PostForm.tsx`
- Delete: `apps/web/lib/data.ts`, `apps/web/lib/categories.ts`, `apps/web/lib/location.ts`
- Modify: `apps/web/lib/posts.ts` (keep the `Post` type; delete the `posts` array and the nearby mock-only types if unused)
- Modify: `apps/web/lib/user.ts` (keep every type export; delete `currentUser` and `users`)
- Modify (type-only imports): `GridCardPost`, `ListCardPost`, `ThreeDotPost`, `PostImage`, `ThreeButton`, `ReportPost`, `About`, `PublicProfileHeader`, `ThreeDotProfile`, `ReportAccount`

**Interfaces:**

- The sell page becomes:

```tsx
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/routing";

export default async function SellPage() {
  const locale = await getLocale();
  redirect({ href: "/post", locale });
}
```

- `lib/posts.ts` keeps `export type Post`; `lib/user.ts` keeps `User`/`BaseUser`/`ManageAds`/`SaveAds`/`LikeAds`/`Notification`/`Chats` types.

- [ ] **Step 1: Replace the sell page with the redirect** (D2).

- [ ] **Step 2: Delete `PostForm.tsx` and the three mock data modules.**

- [ ] **Step 3: Strip runtime mock arrays, keep types.**

`lib/posts.ts`: delete `posts` and `Province`/`District`/`Commune`/`RelatedPost` (no importers). `lib/user.ts`: delete `currentUser` and `users`.

- [ ] **Step 4: Convert value imports of types**

In the listed components change `import { Post } from "@/lib/posts"` / `import { User } from "@/lib/user"` to `import type { … }` where the name is used only in type positions.

- [ ] **Step 5: Verify zero references**

```bash
git grep -nE 'from "@/lib/(data|categories|location)"' -- apps/web        # none
git grep -n "components/post/PostForm" -- apps/web                       # none
git grep -nE 'import \{[^}]*\b(posts|users|currentUser)\b' -- apps/web    # none
pnpm --filter web lint && pnpm --filter web build
```

- [ ] **Step 6: Browser smoke**

`/{locale}/sell` → lands on `/{locale}/post`; the `/post` publish flow still renders the real form for a seeded subcategory; `/km` redirect keeps the locale.

- [ ] **Step 7: Commit**

Skip — no proactive commits.

---

## Task 5: Verify, measure, and document

**Files:**

- Modify: `CLAUDE.md` (Known gaps), `CHANGELOG.md` (Unreleased), `tasks/todo.md` (dated ship entry)

- [ ] **Step 1: Full gates**: `pnpm --filter web lint && pnpm --filter web build | tee /tmp/web-build-after.txt`

- [ ] **Step 2: Bundle delta**: compare First Load JS for home/category/all-ads/search/detail against `/tmp/web-build-baseline.txt`; expected drop is on the order of the mock catalog chunk (~200 KB raw) on feed routes.

- [ ] **Step 3: CDP matrix**: home, category, subcategory, all-ads, search, real detail, job detail, public profile, `/post` (seeded + admin-created fallback), `/sell` redirect, old numeric URL 404, `/km` variants.

- [ ] **Step 4: Server health**: probe `:3000/health` and `:3001` after the run (401/307 = healthy; `000` = a dev server died — restart it).

- [ ] **Step 5: Docs**

- CLAUDE.md Known gaps: correct the stale `lib/post-ad.ts` claim; note the mock modules are gone; `/sell` redirects; numeric detail URLs 404; `DynamicForm` remains the only mock-era form.
- CHANGELOG.md `Unreleased` + `tasks/todo.md` dated entry per repo convention.

- [ ] **Step 6: Commit**

Skip — no proactive commits.

---

## Out of Scope

- Replacing `DynamicForm` for admin-created subcategories (needs a real form; tracked separately).
- Trimming mock-era fields from the `Post` type (`cateId`, `subId`, `proId`, `disId`, `brandId`, `modelId`).
- The backend/performance work from the earlier audit (caching, region, roundtrips) — separate plan.
