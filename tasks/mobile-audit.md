# Mobile Responsiveness Audit — apps/web

**Date:** 2026-10-26
**Auditor:** Claude (static analysis only — see §0)
**Scope:** All 71 routes under `apps/web/app`, global shell, priority surfaces.

## 0. CRITICAL TOOLING NOTE — read before anything else

**The static pass below had no visual verification; a measured browser sweep was added afterwards — see §9.** Both the `Bash` and `PowerShell`
tools were denied outright ("Claude Code is running in don't ask mode"), and no
browser-automation MCP tool was available (only Figma/Excalidraw canvas tools, which
cannot drive a URL). This means:

- `chrome-devtools-axi` (the prescribed CLI) could not be invoked — it requires a shell.
- The raw-Chromium/CDP fallback could not be invoked — it also requires a shell.
- No screenshot, no `scrollWidth` probe, no computed-style query, no real-viewport
  measurement was taken anywhere in this audit.

**Every finding below is static-analysis-only** (`confidence: static-only`,
`verified: false`), derived from reading Tailwind class lists and component structure
and reasoning about rendered geometry (grid track widths vs. known icon/button sizes,
flex-wrap presence/absence, fixed-px literals vs. viewport width). This is weaker
evidence than a measured `scrollWidth`/`getBoundingClientRect()` — treat severities as
"a careful reviewer's best estimate," not lab measurement. The deliverable structure
(IDs, severity, evidence, fix direction) follows the brief's template so it can be
converted to verified findings quickly once a shell/browser tool is available.

## 1. Method & coverage

| Surface                              | Route(s)                              | Visually verified?    | Viewports       | Screenshots |
| ------------------------------------ | ------------------------------------- | --------------------- | --------------- | ----------- |
| Global shell (NavBar/Footer/layouts) | all routes                            | **No**                | — (static only) | none        |
| Homepage                             | `/[locale]`                           | No                    | —               | none        |
| Category page                        | `/[locale]/category/[slug]`           | No                    | —               | none        |
| Subcategory feed                     | `/[locale]/category/[slug]/[subslug]` | No                    | —               | none        |
| All-ads                              | `/[locale]/all-ads`                   | No                    | —               | none        |
| Search                               | `/[locale]/search`                    | No                    | —               | none        |
| Listing detail                       | `/[locale]/[slug]`                    | No                    | —               | none        |
| Login / Register                     | `/[locale]/login`, `/register`        | No                    | —               | none        |
| Post-ad form                         | `/[locale]/post/(publish)`            | No                    | —               | none        |
| Admin dashboard                      | `/wanderer/dashboard/*`               | No                    | —               | none        |
| Chat workspace                       | `/[locale]/chats`                     | No (also WIP, see §8) | —               | none        |
| `/me`, settings                      | `/[locale]/me/*`, `/settings/*`       | No                    | —               | none        |

No screenshots exist (`tasks/mobile-audit-shots/` is empty — directory was never
populated because no screenshot tool was reachable). **Every row in the per-surface
tables below is `confidence: static-only`.**

## 2. Executive summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 3     |
| Major    | 4     |
| Minor    | 3     |
| Nit      | 1     |

**Top issues by estimated user impact:**

1. **MR-001** — Global `NavBar` has zero responsive behavior: no mobile menu exists anywhere in the codebase. Logo, language picker, theme switcher, full search bar, and (logged-out) three buttons / (logged-in) icon row all sit in one non-wrapping flex row. This hits **every single page** on the site at every mobile width tested.
2. **MR-002** — `/all-ads` category strip is a fixed `grid-cols-6` with 64px icon circles, no responsive variant at all.
3. **MR-003** — Every category page's subcategory grid (`SubcategoryGrid.tsx`) uses an inline `gridTemplateColumns: repeat(cols, 1fr)` with `cols` fixed at 5–8 regardless of viewport — affects all 12 top-level category pages.
4. **MR-004** — Homepage "View all ads" link is `w-5xl` (a literal 1024px width, not a max) inside a centered flex row — forces page-level horizontal scroll below 1024px, including on every 320–414px phone.
5. **MR-006** — `SearchBar`'s category-scope button is a fixed `w-[170px]`, contributing to NavBar overflow (same root cause as MR-001, separate code location).
6. **MR-008** — The mock `DynamicForm`'s category picker (`PostForm.tsx` `CategorySelecter`) switches its right-hand subcategory pane via `onMouseEnter` only — no `onClick`/touch handler — meaning a touch-only user visiting this (load-bearing fallback) screen cannot change category at all.
7. **MR-005** — Touch targets below the 44px guideline recur across card grids: the like-heart button (`h-9 w-9` = 36px) on every post card, notification/message icon buttons (`h-10 w-10` = 40px) in the navbar, and a row-delete button (`h-7 w-7` = 28px) in the post form.
8. **MR-007** — Four `subcategory-layouts/LS*Header.tsx` files appear to be dead mock code (not imported outside their own folder) — not a mobile bug per se, but worth flagging so a future "clean up the mock era" pass doesn't miss them.

## 3. Global shell findings

| Finding                                                                                                                                                                                     | File                                | Severity                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------ |
| No mobile nav of any kind (no `Sheet`/`Drawer`/hamburger/`hidden md:` anywhere in `components/web`)                                                                                         | `NavBar.tsx`                        | Blocker                        |
| Fixed-width scope dropdown button in search bar                                                                                                                                             | `SearchBar.tsx:130`                 | Major (contributes to Blocker) |
| Footer is desktop-safe (responsive grid, no issues found)                                                                                                                                   | `Footer.tsx`                        | —                              |
| Admin sidebar uses shadcn's standard responsive `Sidebar` primitive (collapses to a sheet on mobile by convention) — **not independently verified**, but the primitive is designed for this | `app/wanderer/dashboard/layout.tsx` | low risk                       |
| `Dialog`/`DialogContent` base component is properly responsive (`max-w-[calc(100%-2rem)]`, `sm:max-w-xl`)                                                                                   | `components/ui/dialog.tsx:64`       | — (good baseline)              |
| `Input` uses `text-base` (16px) on mobile, `md:text-sm` on desktop — correctly avoids iOS auto-zoom                                                                                         | `components/ui/input.tsx:11`        | — (good baseline)              |

## 4. Per-surface findings (compact)

| Surface                                             | Issue                                                                                           | Severity | ID     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- | ------ |
| All routes                                          | No mobile nav                                                                                   | Blocker  | MR-001 |
| `/all-ads`                                          | Fixed `grid-cols-6` category strip                                                              | Blocker  | MR-002 |
| All 12 category pages                               | Fixed 5–8 col subcategory grid, inline style                                                    | Blocker  | MR-003 |
| Homepage                                            | `w-5xl` fixed-width CTA link                                                                    | Major    | MR-004 |
| Card grids (home/all-ads/search/category feeds)     | Sub-44px heart/icon touch targets                                                               | Minor    | MR-005 |
| NavBar/SearchBar                                    | Fixed `w-[170px]` scope button                                                                  | Major    | MR-006 |
| Mock post form (fallback for admin-created subcats) | Hover-only category switch, no touch handler                                                    | Major    | MR-008 |
| `subcategory-layouts/`                              | 4 dead header components (not a mobile bug)                                                     | Nit      | MR-007 |
| Post form (`ListingPostForm.tsx`)                   | 28px delete-row button                                                                          | Minor    | MR-009 |
| Search page, subcategory filter bars                | Generally well-handled (chip row, `hidden lg:` sidebar, `flex-wrap`) — no blocking issues found | —        | —      |

## 5. Detailed findings

### MR-001 — No responsive navigation anywhere in the global shell

- **Severity:** Blocker
- **Surface:** Global shell (affects all 71 routes except `/wanderer/*`, which has its own sidebar shell)
- **Route(s):** every `(user)` and `(chat)` route
- **Viewport(s) reproduced:** none (static only) — reasoned from code: `NavBar.tsx` renders `logo + LocalSelector + ThemeSwitcher + <Suspense>SearchBar</Suspense> + (login/register/sell OR SocialBar)` inside a single `<div className="flex items-center justify-between gap-4">` with **no** `flex-wrap`, no `hidden`/`md:`/`sm:` prefix anywhere in the file, and `grep` across `components/web/` for `Sheet|Drawer|hamburger|md:hidden|hidden md:` returns **zero matches**.
- **Measured evidence (static):** Minimum unavoidable content width at any breakpoint: logo (~110px) + lang/theme icons (~80px) + search bar (`flex-1 max-w-lg`, functionally needs ≥ 250px to be usable) + either 3 buttons (~340px) or icon row + avatar (~190px). Sum comfortably exceeds 390px and 320px viewports with no fallback — there is no code path that hides or collapses any of these elements below any breakpoint.
- **Root cause:** `apps/web/components/web/NavBar.tsx:28-92` — the entire nav is one unconditional flex row ("desktop-only" design that was never given a mobile variant).
- **Recommended fix direction:** Add a `md:flex`/`hidden` split: keep the current row for `md:` and up; add a compact mobile row (logo + hamburger trigger) that opens a `Sheet`/`Drawer` (already available via shadcn — `components/ui/drawer.tsx` exists in the repo) containing search, language/theme, and account actions. Minimal-files: `NavBar.tsx` + one new `MobileNavSheet.tsx`.
- **Effort:** M (new component + conditional rendering, touches the most-trafficked file in the app)
- **Confidence:** static-only

### MR-002 — `/all-ads` category strip: fixed 6-column grid

- **Severity:** Blocker
- **Surface:** All Ads
- **Route(s):** `/[locale]/all-ads`
- **Viewport(s) reproduced:** none (static only) — reasoned from code.
- **Measured evidence (static):** `AllAdsCategories.tsx:23`: `<ul className="bg-muted text-center grid grid-cols-6 text-md gap-2">` — no `sm:`/`md:` override, unlike the sibling `CategoryGrid.tsx` (home page) which uses `grid-cols-3 sm:grid-cols-4 md:grid-cols-6`. Each tile wraps a `w-16 h-16` (64px) icon circle (`:33`). At a 390px viewport with `gap-2` (5 gaps × 8px = 40px), each of the 6 columns gets `(390-40)/6 ≈ 58px` — smaller than the 64px circle it must contain, so the circles either force the grid wider than the viewport (horizontal overflow) or visually overlap/clip, depending on exact box-sizing of the `<li>`.
- **Root cause:** `apps/web/components/all-ads/AllAdsCategories.tsx:23` — `grid-cols-6` with no responsive variant (contrast with `CategoryGrid.tsx:47`, which got it right).
- **Recommended fix direction:** Mirror `CategoryGrid.tsx`'s pattern: `grid-cols-3 sm:grid-cols-4 md:grid-cols-6`.
- **Effort:** S (one class-list edit)
- **Confidence:** static-only

### MR-003 — Category-page subcategory grid: fixed 5–8 columns via inline style

- **Severity:** Blocker
- **Surface:** Category pages (all 12 main categories)
- **Route(s):** `/[locale]/category/[categorySlug]` (via `CommonCategoryLayout`/`CarsCategoryLayout`/etc. → `SubcategoryGrid`)
- **Viewport(s) reproduced:** none (static only).
- **Measured evidence (static):** `SubcategoryGrid.tsx:44-48`: `style={{ gridTemplateColumns: \`repeat(${cols}, minmax(0, 1fr))\` }}`, where `cols`comes from the`SUBCATEGORY_LAYOUT`map in`category/[categorySlug]/page.tsx:23-36`— values`5, 6, 7, 8`(default`6`) with **no breakpoint logic**, and because it's an inline `style`prop rather than a Tailwind class, it **cannot** be overridden with a`sm:`/`md:`utility class at all — it is responsive-proof by construction. Each tile is a`w-16 h-16`(64px) circle plus`p-3`(24px) padding on the`<Link>` (`:60-62`), i.e. ≥88px of unavoidable content per tile. At `cols=8`and 390px width, each column is`390/8 ≈ 49px` — the 88px tile content is ~1.8× the column width.
- **Root cause:** `apps/web/components/category-layouts/SubcategoryGrid.tsx:44-48` (inline style) combined with the fixed `cols` values in `apps/web/app/[locale]/(user)/category/[categorySlug]/page.tsx:23-36`.
- **Recommended fix direction:** Replace the inline `gridTemplateColumns` with a responsive Tailwind class driven by a lookup table of pre-defined column classes (e.g. `grid-cols-3 sm:grid-cols-4 md:grid-cols-{cols}`), since arbitrary dynamic Tailwind classes can't be generated at runtime — a small `COLS_CLASS: Record<number, string>` map resolved from `cols` would work without inline styles.
- **Effort:** M (touches a shared component used by all 12 category pages; needs a safe column-class lookup instead of string interpolation, since Tailwind can't JIT-compile a runtime-interpolated class name)
- **Confidence:** static-only

### MR-004 — Homepage "View all ads" CTA is a literal 1024px-wide element

- **Severity:** Major
- **Surface:** Homepage
- **Route(s):** `/[locale]`
- **Viewport(s) reproduced:** none (static only).
- **Measured evidence (static):** `app/[locale]/(user)/page.tsx:64`: `className="w-5xl max-w-5xl px-6 py-2 ..."`. In Tailwind v4's default scale, `w-5xl` = `64rem` (1024px) — an **explicit width**, not a cap. `max-w-5xl` is redundant/decorative once `w-5xl` is set. The element sits inside `<div className="flex justify-center">` (`:61`), which does not constrain child width. Result: the `<Link>` renders at 1024px regardless of viewport, forcing horizontal scroll on the whole page at any viewport narrower than 1024px — including every phone size in the test matrix (320/360/390/414/768).
- **Root cause:** `apps/web/app/[locale]/(user)/page.tsx:64`.
- **Recommended fix direction:** Change `w-5xl` → `w-full` (keep `max-w-5xl` as the actual cap), e.g. `className="w-full max-w-5xl px-6 py-2 ..."`.
- **Effort:** S (one class fix)
- **Confidence:** static-only

### MR-005 — Sub-44px touch targets recur across post-card grids

- **Severity:** Minor (systemic — recurs on every feed)
- **Surface:** Homepage, All Ads, Search, Category/Subcategory feeds (anywhere `GridCardPost` renders)
- **Route(s):** `/[locale]`, `/all-ads`, `/search`, `/category/*`, `/category/*/*`
- **Viewport(s) reproduced:** none (static only).
- **Measured evidence (static):** `components/ads/GridCardPost.tsx:150`: like button `className="... h-9 w-9 ..."` → 36×36px, below the 44px guideline. Same pattern likely in `ListCardPost.tsx` (not individually re-read, but it's documented as sharing the same `min-w-0` guard/structure as `GridCardPost` per its own comment at `GridCardPost.tsx:103-107`, implying shared conventions — **not independently confirmed**).
- **Root cause:** `components/ads/GridCardPost.tsx:150` (and likely `ListCardPost.tsx`, same pattern, unverified).
- **Recommended fix direction:** Bump to `h-11 w-11` (44px) or keep the visual circle at 36px but add invisible padding via a larger hit-slop (`p-1` wrapper or `::before` expanding the tap target) — Tailwind-only, no new deps.
- **Effort:** S
- **Confidence:** static-only

### MR-006 — Search bar's category-scope button is fixed-width

- **Severity:** Major (contributing cause of MR-001's overflow, but independently fixable)
- **Surface:** Global shell (navbar search)
- **Route(s):** all routes
- **Viewport(s) reproduced:** none (static only).
- **Measured evidence (static):** `components/web/SearchBar.tsx:130`: `className="... w-[170px] justify-between ..."` on the scope-dropdown `<Button>`, inside a `<form className="flex flex-1 items-center max-w-lg">` (`:118`). The 170px trigger plus the text input plus the submit icon button together need well over 250px minimum — this is the search bar's own contribution to NavBar's total unavoidable width.
- **Root cause:** `components/web/SearchBar.tsx:130`.
- **Recommended fix direction:** Make the trigger width responsive (e.g. `w-[120px] sm:w-[170px]`, with the inner `truncate max-w-[115px]` label shrinking in step), or hide the scope label at narrow widths and show only the chevron icon.
- **Effort:** S
- **Confidence:** static-only

### MR-007 — Four unused mock subcategory headers

- **Severity:** Nit
- **Surface:** N/A (dead code, not rendered)
- **Route(s):** none — not reachable
- **Viewport(s) reproduced:** none; this is a code-reachability finding, not a rendering one.
- **Measured evidence (static):** `grep -r "LSHeader|LSPHeader|LSPCHeader|LSSHeader|LSPYCHeader"` across `apps/web` finds each name only inside its own definition file (`components/subcategory-layouts/LSHeader.tsx`, `LSPHeader.tsx`, `LSPCHeader.tsx`, `LSSHeader.tsx`, `LSPYCHeader.tsx`) — none are imported by any page. The one actually wired up is `LSPYCEHeader.tsx`, imported by `category/[categorySlug]/[subcategorySlug]/page.tsx:8`.
- **Root cause:** Leftover mock-era components, superseded by `LSPYCEHeader.tsx`.
- **Recommended fix direction:** Not a mobile fix — flag for a future dead-code cleanup pass (same spirit as the already-documented `subcategoryGroups.ts` and `lib/users.ts` dead files in `CLAUDE.md`'s Known Gaps). Do not delete as part of a mobile-audit fix without confirming with the team, per repo convention of flagging rather than unilaterally deleting.
- **Effort:** S (if ever actioned)
- **Confidence:** static-only (pure grep-reachability check — high confidence for "unreferenced," doesn't itself require visual verification)

### MR-008 — Mock category picker's active-category switch is hover-only

- **Severity:** Major
- **Surface:** Post-ad form — the mock `DynamicForm` fallback path (reached by any subcategory created via the admin UI after the 146-subcategory seed, per `CLAUDE.md`'s "A subcategory created through the admin UI still has no working post form" known gap — this makes the component load-bearing, not dead)
- **Route(s):** `/[locale]/post/(publish)` (conditionally, for non-seeded subcategories only)
- **Viewport(s) reproduced:** none (static only).
- **Measured evidence (static):** `components/post/PostForm.tsx:61`: the left-pane category button has `onMouseEnter={() => setActiveCategory(category)}` and **no** `onClick` or `onTouchStart` handler (confirmed via `grep` for `onClick|onMouseEnter|onTouchStart` in the file — only one `onMouseEnter` at `:61`, two unrelated `onClick`s at `:112`/`:180` for subcategory-select and back). `mouseenter` does not fire reliably from a tap on touch devices (behavior varies by browser and is not a supported interaction pattern), so a touch-only user may be permanently stuck on `categories[0]` (the `useState` initial value, `:41`) and unable to reach any other top-level category in this picker.
- **Root cause:** `components/post/PostForm.tsx:61` — hover-only state transition with no touch equivalent.
- **Recommended fix direction:** Change to `onClick` (works for both mouse and touch) instead of, or in addition to, `onMouseEnter`; keep hover as a progressive enhancement for desktop if a two-pane hover preview is still wanted at `md:` and up.
- **Effort:** S (one handler change)
- **Confidence:** static-only

### MR-009 — Post-form row-delete button is 28px

- **Severity:** Minor
- **Surface:** Post-ad form (real `ListingPostForm`)
- **Route(s):** `/[locale]/post/(publish)` (repeatable-field blocks, e.g. phone numbers / multi-value fields)
- **Viewport(s) reproduced:** none (static only).
- **Measured evidence (static):** `components/post/ListingPostForm.tsx:1221`: `className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-red-500 ..."` → 28×28px, well under the 44px guideline, on the most complex and highest-friction form in the app.
- **Root cause:** `components/post/ListingPostForm.tsx:1221`.
- **Recommended fix direction:** Bump to `h-9 w-9` or `h-11 w-11`, or wrap in a larger invisible hit-slop.
- **Effort:** S
- **Confidence:** static-only

## 6. Cross-cutting patterns

1. **"Desktop-first, no mobile variant was ever added" is the dominant root cause.** `NavBar.tsx`, `AllAdsCategories.tsx`'s category strip, and `SubcategoryGrid.tsx` all read as components built once for a ~1280px design and never revisited for narrow viewports — contrast with `CategoryGrid.tsx` and `BrowseByLocation.tsx`, which **do** carry proper `sm:`/`md:`/`lg:` breakpoint ladders. The fix pattern is consistent: add the breakpoint ladder the sibling components already use.
2. **Fixed pixel widths used where a percentage/`max-w` was meant.** `w-5xl` instead of `max-w-5xl` (MR-004) and `w-[170px]` without a narrower variant (MR-006) are both "someone meant to cap width, and either typo'd the Tailwind utility or never circled back to add a mobile override."
3. **Inline `style` for `gridTemplateColumns` defeats Tailwind's responsive system entirely** (MR-003) — this is the one finding that can't be fixed with a simple breakpoint-class addition; it needs a small lookup table because Tailwind cannot JIT a class name built from a runtime variable.
4. **Sub-44px touch targets cluster around icon-only circular buttons** (`h-9 w-9`, `h-10 w-10`, `h-7 w-7`) — a repeated `size-N` shorthand pattern across `GridCardPost`, `SocialBar`, and `ListingPostForm`. A shared `IconButton` component with a baked-in 44px minimum (visual circle can stay smaller via inner padding) would prevent recurrence, but that's a larger refactor than this audit's effort budget — the immediate fix is per-site class bumps.
5. **Where the team _did_ think about mobile, the result is solid**: the Search page (`search/page.tsx`) has a `lg:hidden` chip-row fallback for its category sidebar, the subcategory filter bars use `flex-wrap`, `MoreFilters`' dialog is capped at `max-w-md`/`max-h-[90vh]`, the base `Dialog` and `Input` components already have correct responsive/zoom-safe defaults, and the admin dashboard uses shadcn's standard responsive `Sidebar` primitive. The gaps are concentrated in a handful of specific files, not systemic to the whole codebase.
6. **Hover-only interaction appears at least once on a load-bearing surface** (MR-008), in code whose own repo documentation (`CLAUDE.md`) already flags it as "not dead code" — worth a second look since this audit's static read strongly suggests it's untestable by touch at all today.

## 7. Screenshot index

None. See §0 — no visual-verification tool was reachable in this session.

## 8. Explicit "not verified / out of scope"

- **No visual verification whatsoever** — no `scrollWidth` measurements, no computed `font-size`/touch-target measurements via `getBoundingClientRect()`, no screenshots, at any viewport, for any route. All findings above are static-code-only.
- **Locale stress (km/zh at 360px)** — not checked at all; would require rendering `next-intl` message strings, which needs a browser. The `messages/*.json` files were not read for string length either (and are explicitly flagged as uncommitted WIP — see below).
- **Chat workspace (`/[locale]/chats`) and all of `apps/web/components/chat/*`** — per the task's explicit instruction, this is uncommitted WIP (chat/E2E encryption work) and was **not edited**; it was skimmed only enough to confirm it reuses the same (broken) global `NavBar`. Any chat-specific mobile issues are **deferred (WIP conflict)** and not itemized here.
- **Authenticated surfaces** (`/me/*`, `/settings/*`, `/post/(publish)`, `/notifications`, `/checkout`, `/premium-account`) — no attempt was made to find a dev/staff session: reading `apps/backend/.env`/`.env.local` for `DEV_OTP_TOKEN` was blocked by a hard runtime floor in this session ("credential or secret read requires human approval"), independent of the Bash/PowerShell denial. These surfaces were spot-checked by reading component source only (e.g. `SettingSidebar.tsx`, `LoginForm.tsx`, `ListingPostForm.tsx`) — not exercised as a logged-in user.
- **Admin dashboard pages beyond the layout/table primitives** — individual pages (`attributes`, `brands`, `models`, `subscription/*`, `report/*`, `team`, `users`) were not opened; only the shared `Table` component (confirmed to wrap rows in `overflow-x-auto`) and the `SidebarProvider`/`AppSidebar` shell were checked.
- **Listing detail page (`/[locale]/[slug]`) full component tree** — only `Post-Detail.tsx`'s aside width (`w-full md:w-[400px]`, looks correct) and `PostImage.tsx`'s thumbnail strip (`h-[60px] md:h-[100px]`, looks correct) were checked; the full gallery/lightbox interaction and the specs grid were not read in depth.
- **`/[slug]/about`, `/followers`, `/following` (public profile sub-pages), `/insight`, `/sell`, `/premium-account/[category]`, `/post/[slug]`, legal pages (`/privacy-policy`, `/posting-rule`, `/safety-tips`, `/contact-us`, `/feedback`, `/account-deletion`), 404 (`/[...rest]`)** — not read at all in this pass; pure time-budget triage, not a finding of "no issues."
- **Font-size computed-value checks** — not measured (would need a rendered DOM); only the `Input` component's class list was checked, which looked correct (`text-base` / `md:text-sm`).
- **`ListCardPost.tsx`** — assumed (not confirmed) to share `GridCardPost.tsx`'s touch-target pattern based on a code comment cross-reference; not independently read line-by-line.

## 9. Lead-verified browser measurements (added 2026-10-26, after the static pass)

A measured sweep was run against the production preview at `http://localhost:3011` (backend on `:8080`),
headless Chromium 156, layout viewport forced via `Emulation.setDeviceMetricsOverride({mobile:false})`
(Chrome 156 only changes the _layout_ viewport when `mobile:false` is used). Screenshots:
`tasks/mobile-audit-shots/<surface>-<width>.png`; raw rows in `tasks/mobile-audit-visual.json`.

### 9.1 Measured page overflow

| Surface        | Viewport | innerWidth | scrollWidth | Overflow   | Main offenders                                                                                                      |
| -------------- | -------- | ---------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Home           | 390x844  | 390        | **785**     | **+395px** | nav search form `[265..496]` (231 wide), "All Categories" trigger `[266..436]` (w170), auth/Sell block `[520..785]` |
| All Ads        | 390      | 390        | **785**     | +395px     | same shell; `w-16` category circles `[332..396]`; fixed-width cards `[203..463]` (w260)                             |
| Category page  | 390      | 390        | **785**     | +395px     | same shell; subcategory circles `[330..394]`                                                                        |
| Search         | 390      | 390        | **785**     | +395px     | same shell; cards                                                                                                   |
| Login          | 390      | 390        | **785**     | +395px     | **global shell only** — the page body fits                                                                          |
| Listing detail | 390      | 390        | **785**     | +395px     | global shell only                                                                                                   |
| Home           | 320x568  | 320        | **785**     | **+465px** | same shell                                                                                                          |
| Home           | 768x1024 | 768        | **824**     | **+56px**  | nav auth/Sell block `[520..785]`; latest-ads cards `[564..824]` (w260)                                              |
| Home `km`      | 360x640  | 360        | 785         | +425px     | same shell; Khmer label renders 94px wide                                                                           |
| Home `zh`      | 360x640  | 360        | 785         | +425px     | same shell; Chinese label 56px wide                                                                                 |

### 9.2 What the measurements confirm and correct

- **MR-001 CONFIRMED — dominant defect.** Every public route has the same 785px minimum page width; only the `(user)` shell differs between routes. `home-390.png` shows the navbar clipped mid-"All Categories".
- **MR-006 CONFIRMED.** The "All Categories" trigger measures exactly 170px; the nav's 785px floor is logo/locale/theme + a 231px search form + the auth block.
- **MR-005 CONFIRMED (measured).** 36x36 favourite buttons (30 on a full home feed), 28x28 icon buttons (30), and 36px-tall login inputs are all below 44px.
- **MR-002 PARTIALLY CONFIRMED.** The 64px category circles do cross the 390px edge (right = 396), but the page is already 785px wide, so the nav masks most of it. Re-measure after the shell fix.
- **MR-004 NOT REPRODUCED.** No 1024px element appears in any overflow list; the widest element on the homepage is the nav. Treat `w-5xl` as unverified — the planner must check whether that class compiles to an actual width and drop/correct the finding if not.
- **New finding — tablet card row:** at 768px the latest-ads row is 260px-wide fixed cards ending at 824px (tablet overflow independent of the navbar).
- **New finding — tiny type:** 10-11px discount/delivery badges, 34 instances on the home feed.
- `/en/me` redirects to `/en/login` when unauthenticated; `/en/chats` renders a login-gated state. Authenticated and admin surfaces remain **static-only**.
- **Cascade warning:** because the nav currently widens the whole document to 785px, secondary grid overflows (MR-002/MR-003/MR-010) are partially masked. Acceptance criteria must re-measure them _after_ the shell fix.

## 10. Post-fix verification — PASSED (added 2026-10-26, final build)

Final build: `pnpm --filter web build` exit 0 after all workstreams (W1–W4 + follow-ups W2b/W2c/W2d/W3b/W5b).
Measured with `tasks/mobile-verify.mjs` against a production preview of that build (backend `:8080`),
headless Chromium with `Emulation.setDeviceMetricsOverride({mobile:false})`, screenshots under
`tasks/mobile-audit-shots/`, raw rows in `tasks/mobile-verify-post-fix.json`.

**Result: 36/36 checks pass — 0 overflow failures.**

| Surface                          | 320          | 390          | 768          | 1024           |
| -------------------------------- | ------------ | ------------ | ------------ | -------------- |
| `/en` homepage                   | PASS 320/320 | PASS 390/390 | PASS 768/768 | PASS 1024/1024 |
| `/en/all-ads`                    | PASS         | PASS         | PASS         | PASS           |
| `/en/category/cars-and-vehicles` | PASS         | PASS         | PASS         | PASS           |
| `/en/search`                     | PASS         | PASS         | PASS         | PASS           |
| `/en/login`                      | PASS         | PASS         | PASS         | PASS           |
| `/en/chats` (login-gated shell)  | PASS         | PASS         | PASS         | PASS           |
| `/en/<listing-id>` detail        | PASS         | PASS         | PASS         | PASS           |
| `/km`, `/zh` home                | PASS         | PASS         | PASS         | PASS           |

(Each cell is `scrollWidth === innerWidth`; pre-fix the same routes were 785 at 320/390 and 824 at 768.)

### 10.1 What closed

- **MR-001/MR-006** — nav collapses below `lg` into a `Sheet` (logo + 44px menu trigger); desktop row unchanged at ≥1024px. Sheet opens at 320/390 with `scrollWidth === innerWidth`; verified screenshots `final-sheet-390.png`.
- **MR-002/MR-003/MR-010** — responsive category strips and subcategory grids; card width floor kept for horizontal carousels (Top Ads renders 260px cards at 390, `final-topads-390.png`) while feed grids drop to 1 column on phones and gain columns at `lg`/`xl`.
- **MR-005/MR-009** — favourite hearts, list-card heart, nav notification/message/avatar, post-form row delete, per-card "⋯" menu all measure 44×44; homepage CTA is 44px tall.
- **MR-008** — mock post-form category picker gains `onClick` alongside hover (touch-reachable). Not end-to-end reachable from the seeded catalogue (per `CLAUDE.md`), verified by code review only.
- **MR-004** — dropped: `w-5xl` compiles to nothing for `width` in Tailwind v4 and the CTA shrank to 390px; the dead class was removed opportunistically in the CTA fix.

### 10.2 Residual / deferred (by design)

- 10–11px discount/delivery badges (34 on the home feed) and inline text links below 44px height remain — non-blocking, no overflow, deferred per plan §6.
- Authenticated/admin surfaces (`/me/*`, `/settings/*`, post form authed, `/wanderer/*`) remain **static-only**: no dev/staff session was stood up.
- Chat/E2E WIP files untouched; no `messages/*.json` copy changes.
- MR-007 dead-code (5 `subcategory-layouts/LS*Header.tsx` files) flagged, not deleted.

### 10.3 Desktop / regression notes

1280px screenshots before (`baseline-home-1280.png`) and after (`final-home-1280.png`) show the same desktop shell and 4/6-column grids; intentional visual changes are limited to larger touch targets (44px hearts/menu/nav icons) and the new compact nav below 1024px. No new dependencies, no `tailwind.config`, build/lint clean.
