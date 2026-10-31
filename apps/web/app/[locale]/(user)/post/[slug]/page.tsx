import PostDetail from "@/components/post/Post-Detail";
import { buildRealDetailData, getListingById } from "@/lib/api/categories";
import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getFollowStatus } from "@/lib/api/users";
import { loadJobApplyState } from "@/lib/api/job-apply";
import { getAdvertisements } from "@/lib/api/advertisements";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extract the actual ID if the URL has the slug format (e.g., "post-title-adid-123")
function extractId(slug: string): string {
  return slug?.includes("-adid-") ? slug.split("-adid-").pop() || slug : slug;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
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

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const actualId = extractId(slug);
  const locale = await getLocale();
  const [viewer, banners] = await Promise.all([
    getCurrentUser(),
    getAdvertisements("listing_detail"),
  ]);

  if (UUID_RE.test(actualId)) {
    const real = await buildRealDetailData(actualId, locale);
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
