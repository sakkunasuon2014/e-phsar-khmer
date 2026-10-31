import PostDetail from "@/components/post/Post-Detail";
import PublicProfileHeader from "@/components/profile/PublicProfileHeader";
import ProfileTabBody from "@/components/profile/ProfileTabBody";
import {
  buildRealDetailData,
  getAllCategories,
  getListingById,
  getListingsFeed,
  toCardPost,
} from "@/lib/api/categories";
import { ALL_ADS_PAGE_SIZE } from "@/lib/all-ads";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadJobApplyState } from "@/lib/api/job-apply";
import { getAdvertisements } from "@/lib/api/advertisements";
import { redirect } from "@/i18n/routing";
import { notFound } from "next/navigation";
import {
  displayName,
  getFollowStatus,
  getPublicProfile,
  toProfileUser,
} from "@/lib/api/users";
import type { Metadata } from "next";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractId(slug: string): string {
  return slug?.includes("-adid-") ? slug.split("-adid-").pop() || slug : slug;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  if (slug?.includes("-adid-")) {
    const actualId = extractId(slug);
    // Real listings are looked up by UUID; any other id is a dead link.
    if (UUID_RE.test(actualId)) {
      const listing = await getListingById(actualId, "en");
      if (listing) {
        return {
          title: listing.title,
          description: listing.description ?? "Post Detail",
        };
      }
    }
    return { title: "404 Not found" };
  }

  // Otherwise, treat as username
  const profile = await getPublicProfile(slug);
  if (profile) {
    const name = displayName(profile);
    const t = await getTranslations("Profile");
    return {
      title: name,
      description: t("metaDescription", { name }),
    };
  }
  // Unknown slug — the not-found boundary renders the 404 page.
  return { title: "404 Not found" };
}

export default async function SlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // Both resolved against the seller's own tree below — a profile URL's
  // `?category=`/`?subcategory=` is only meaningful if that seller actually
  // posts there. They seed `HomeProfile`'s drill-down state, so a reload or a
  // shared link lands on the same level rather than the right listings under
  // the wrong row.
  const rawCategory = typeof sp.category === "string" ? sp.category : undefined;
  const rawSubcategory =
    typeof sp.subcategory === "string" ? sp.subcategory : undefined;

  // Handle Post Detail — a real listing UUID renders the detail template; any
  // other id is a dead link.
  if (slug?.includes("-adid-")) {
    const actualId = extractId(slug);
    const [viewer, banners] = await Promise.all([
      getCurrentUser(),
      getAdvertisements("listing_detail"),
    ]);
    if (UUID_RE.test(actualId)) {
      const real = await buildRealDetailData(actualId, await getLocale());
      // A real listing that is gone (draft, withdrawn, moderated, unknown id)
      // must 404 rather than render a fabricated ad at a dead link.
      if (!real) notFound();
      return (
        <PostDetail
          real={real}
          banners={banners}
          viewerId={viewer?.id}
          sellerFollowing={
            viewer ? await getFollowStatus(real.listing.userId) : false
          }
          jobApply={await loadJobApplyState({
            listingId: real.listing.id,
            categorySlug: real.cate?.slug,
            listingStatus: real.listing.status,
            posterId: real.listing.userId,
            viewerId: viewer?.id,
          })}
        />
      );
    }
    notFound();
  }

  // Handle Public Profile — a real account, looked up by handle.
  const profile = await getPublicProfile(slug);
  if (!profile) notFound();

  const locale = await getLocale();
  const user = toProfileUser(profile, locale);
  const viewer = await getCurrentUser();
  const following = await getFollowStatus(profile.id);

  // Follower lists need a session — that is what lets every row carry its
  // viewer-relative `isFollowing` in one request. A `?tab=` link opened cold
  // therefore bounces to sign-in, the same thing the routes it replaced did.
  const listTab =
    sp.tab === "following" || sp.tab === "followers" ? sp.tab : undefined;
  if (listTab && !viewer) return redirect({ href: "/login", locale });

  // The seller's own tree — both levels scoped to what they posted in. It
  // drives the panel's category row, and it is what makes a foreign or stale
  // `?category=`/`?subcategory=` fall back to the unfiltered feed instead of a
  // filtered grid whose tile is not on the page and which nothing could clear.
  const sellerCategories = (await getAllCategories(locale, profile.id)) ?? [];
  const category =
    rawCategory && sellerCategories.some((c) => c.slug === rawCategory)
      ? rawCategory
      : undefined;
  // Validated inside the chosen category, not just anywhere in the tree — a
  // `?category=cars&subcategory=phones` would otherwise render a breadcrumb
  // that lies about where you are.
  const subcategory = category
    ? sellerCategories
        .find((c) => c.slug === category)
        ?.subcategories.find((s) => s.slug === rawSubcategory)?.slug
    : undefined;

  // The seller's post history, first screen only — `HomeProfile` fetches the
  // next slice itself as the visitor drills. The feed is active-only and
  // anonymous, so this needs no session and can never show a draft.
  const feed = await getListingsFeed(
    {
      userId: profile.id,
      categorySlug: category,
      subcategorySlug: subcategory,
      limit: ALL_ADS_PAGE_SIZE,
    },
    locale,
  );

  return (
    <>
      <PublicProfileHeader
        user={user}
        viewerId={viewer?.id ?? null}
        initialFollowing={following}
      />
      {/* The seller's ads, or one of their follow lists when `?tab=` says so.
          That switch happens in the browser — this page never re-renders for
          it — so the props here are the feed's first screen either way. */}
      <ProfileTabBody
        userId={profile.id}
        viewerId={viewer?.id ?? null}
        categories={sellerCategories}
        initialSelection={{ category, subcategory }}
        initialPosts={(feed?.items ?? []).map(toCardPost)}
        initialCursor={feed?.nextCursor ?? null}
        locale={locale}
      />
    </>
  );
}
