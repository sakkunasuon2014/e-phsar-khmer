"use client";
import { useEffect, useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Truck } from "lucide-react";
import AdvertisementCarousel from "@/components/ads/AdvertisementCarousel";
import type { AdvertisementCard } from "@/lib/api/advertisements";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { IconClockHour4, IconMapPin } from "@tabler/icons-react";
import ProfileSidebar from "./Profile-Sidebar";
import LoanCalculator from "./LoanCalculator";
import ContactUser from "./ContactUser";
import { ThreeButton } from "./ThreeButton";
import PostImage from "./PostImage";
import { PostSocialActions } from "./PostSocialActions";
import { ApplyJobButton } from "./ApplyJobButton";
import type { ApplyResumeSummary } from "./ApplyJobDialog";
import ListingSpecs from "./ListingSpecs";
import type { BackendListing, BackendProductRef } from "@/lib/api/categories";
import type { Post } from "@/lib/posts";
import type { User } from "@/lib/user";
import type { ListingContext } from "@/types/chat";
import { applyDiscount, shortLocation } from "@/lib/utils";
import { trackEvent } from "@/lib/insights/queue";

/**
 * Listing data slotted into this template. The page (RSC) builds this from
 * `GET /listings/:id` + the categories list (breadcrumb) + the listing's own
 * contact fields (seller card).
 */
export interface RealDetailData {
  listing: BackendListing;
  /** Km display values for the listing's attribute keys (taxType, bodyType, color, …). */
  valueLabels?: Record<string, string>;
  cate?: { slug: string; name: string };
  subcate?: { slug: string; name: string };
  brand?: { slug: string; name: string };
  model?: { slug: string; name: string };
  /** Trusted spec page linked to this listing, while published. */
  product?: BackendProductRef | null;
  seller: User;
}

/**
 * What the Apply control needs beyond the listing itself — assembled by the
 * page only for a real, active job listing the viewer neither owns nor has
 * already applied to. Absent means "render no Apply control at all".
 */
export interface JobApplyState {
  /** The viewer's existing application id, when they already applied. */
  appliedApplicationId: string | null;
  resume: ApplyResumeSummary | null;
}

/** Adapt a backend listing into the template's local `Post` shape. */
function toPostView(l: BackendListing): Post {
  // Null is a real state — see `toCardPost`. A no-price listing must not be
  // shown as $0; the template prints "Negotiable" for it.
  const price =
    l.price !== null && Number.isFinite(Number(l.price))
      ? Number(l.price)
      : null;
  const discount =
    l.discountValue !== null &&
    l.discountType !== null &&
    Number(l.discountValue) > 0
      ? `${Number(l.discountValue)}${l.discountType === "percent" ? "%" : " $"}`.trim()
      : undefined;
  // A zero/negative discount is "no discount" — do not strike through the
  // price for it (the "-0%" badge bug, captain 2026-10-28).
  const hasDiscount =
    price !== null &&
    l.discountType !== null &&
    l.discountValue !== null &&
    Number(l.discountValue) > 0;
  return {
    postId: l.id,
    userId: l.userId,
    title: l.title,
    images: l.photos.map((p) => p.url),
    imageCount: l.photos.length,
    // The listing price is the ORIGINAL; the discount applies on top — the
    // bold price is the final, the strikethrough is the original.
    price:
      price === null
        ? null
        : applyDiscount(price, l.discountValue, l.discountType),
    cateId: "",
    subId: "",
    brandId: undefined,
    modelId: undefined,
    oldPrice: hasDiscount ? (price ?? undefined) : undefined,
    discount,
    description: l.description ?? "",
    createdat: new Date(l.createdAt),
    proId: "",
    disId: "",
    freeDelivery: l.deliveryFree,
    // Seeds the "N Likes" control; toggle responses update it from there.
    likeCount: l.likeCount ?? 0,
  };
}

/** Preview card handed to "Message seller" — see ContactSellerButton. */
function toListingContext(l: BackendListing): ListingContext {
  return {
    id: l.id,
    title: l.title,
    price: l.price,
    currency: l.currency ?? "USD",
    status: isListingStatus(l.status) ? l.status : "active",
    thumbnailUrl: l.photos[0]?.url ?? null,
  };
}

function isListingStatus(value: string): value is ListingContext["status"] {
  return (
    value === "draft" ||
    value === "active" ||
    value === "expired" ||
    value === "deleted"
  );
}

export default function PostDetail({
  real,
  viewerId,
  sellerFollowing = false,
  jobApply = null,
  banners = [],
}: {
  real: RealDetailData;
  /** Signed-in viewer's id, if any — lets the sidebar tell "your ad" apart
   *  from a stranger's and hide seller-contact actions accordingly. */
  viewerId?: string | null;
  /** Whether that viewer already follows the seller — seeds the sidebar toggle. */
  sellerFollowing?: boolean;
  /** Present only when this viewer may apply to *this* job listing. */
  jobApply?: JobApplyState | null;
  /** The `listing_detail` banners — fetched by the server page above this one. */
  banners?: AdvertisementCard[];
}) {
  const t = useTranslations();
  const format = useFormatter();
  const realListingId = real.listing.id;
  const realListingOwnerId = real.listing.userId;
  const viewTrackedFor = useRef<string | null>(null);

  // One view per listing per mounted detail page. The ref is keyed by id so
  // Strict Mode cannot double-count and client navigation between listings
  // still records the new one.
  useEffect(() => {
    if (viewerId && viewerId === realListingOwnerId) return;
    if (viewTrackedFor.current === realListingId) return;

    viewTrackedFor.current = realListingId;
    trackEvent(realListingId, "view");
  }, [realListingId, realListingOwnerId, viewerId]);

  const post = toPostView(real.listing);
  const user = real.seller;
  if (!user) return null;
  const cate = real.cate;
  const subcate = real.subcate;
  const brand = real.brand;
  const model = real.model;
  // The trusted spec page the listing links to; the backend nulls it once the
  // page is unpublished, so the link hides by itself.
  const product = real.product;

  const hasBrand = !!brand;
  const hasModel = !!model;

  // The one listing family whose header differs: a job moves the like/share
  // pair beside the title and carries the Apply control (captain's mock,
  // 2026-10-16). Every other listing renders exactly as before.
  const isJobListing = cate?.slug === "jobs";

  // A lapsed ad keeps its link (shares, old messages) but is no longer a live
  // offer: the API reports it as `expired`, and the page must say so and stop
  // offering contact (captain, 2026-10-27).
  const isExpired = real.listing.status === "expired";

  const listingContext = toListingContext(real.listing);

  const displayId = real.listing.id.slice(0, 8).toUpperCase();
  // Two forms of the same value, in two places: the ID row carries the card's
  // short `district, province`, while the contact block below spells the whole
  // location out with the street address on its own line (see ContactUser).
  const fullLocation = real.listing.location ?? undefined;
  const addressLine = real.listing.address ?? undefined;
  const locationLine = shortLocation(real.listing.location) ?? "";

  // The pin the seller dropped when posting (numeric columns arrive as strings).
  const lat =
    real.listing.latitude != null ? Number(real.listing.latitude) : NaN;
  const lng =
    real.listing.longitude != null ? Number(real.listing.longitude) : NaN;
  const coords =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  return (
    <main className="min-h-screen flex flex-col bg-muted block pt-6">
      {/* Ad Banner */}
      {banners.length > 0 && (
        <div className="max-w-4xl mx-auto w-full gap-4 px-4 pb-4">
          <div className="flex-1 space-y-2">
            <AdvertisementCarousel banners={banners} priority />
          </div>
        </div>
      )}
      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto w-full pb-2">
        <Breadcrumbs
          className="flex-wrap"
          items={[
            { label: t("Search.home"), href: "/" },
            ...(cate
              ? [
                  {
                    label: cate.name,
                    href: {
                      pathname: "/category/[categorySlug]" as const,
                      params: { categorySlug: cate.slug },
                    },
                  },
                ]
              : []),
            ...(subcate
              ? [
                  {
                    label: subcate.name,
                    href: {
                      pathname:
                        "/category/[categorySlug]/[subcategorySlug]" as const,
                      params: {
                        categorySlug: cate?.slug || "",
                        subcategorySlug: subcate.slug,
                      },
                    },
                  },
                ]
              : []),
            ...(hasBrand
              ? [
                  {
                    label: brand.name,
                    href: {
                      pathname:
                        "/category/[categorySlug]/[subcategorySlug]/[brandOrType]" as const,
                      params: {
                        categorySlug: cate?.slug || "",
                        subcategorySlug: subcate?.slug || "",
                        brandOrType: brand.slug,
                      },
                    },
                  },
                ]
              : []),
            ...(hasModel ? [{ label: model.name }] : []),
          ]}
        />
      </div>
      {/* Main content */}
      <div className="max-w-7xl mx-auto w-full mt-2 mb-10">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 w-full min-w-38 space-y-4">
            <div className="bg-card border rounded-sm overflow-hidden">
              {isExpired && (
                <div className="border-l-3 border-l-[#f68b1e] bg-[#fdf0e6] px-4 py-3 type-body-sm text-foreground">
                  {t("Post.expiredNotice")}
                </div>
              )}
              {/* A job ad leads with its logo beside the details, not with a
                  full-bleed banner (the captain's mock): the strip of small
                  images is the gallery, the title/price/Apply block sits next
                  to it. Every other listing keeps the hero gallery above. */}
              <div
                className={
                  isJobListing
                    ? "flex flex-col sm:flex-row gap-3 p-3"
                    : undefined
                }
              >
                <PostImage
                  post={post}
                  showActions={!isJobListing}
                  variant={isJobListing ? "thumbs" : "hero"}
                />
                <div
                  className={
                    isJobListing ? "min-w-0 flex-1 sm:pt-0.5" : "px-4 pt-3 pb-0"
                  }
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <h1 className="type-page-title text-foreground flex-1 min-w-0">
                      {post.title}
                    </h1>
                    {isJobListing && (
                      <PostSocialActions
                        post={post}
                        className="flex gap-2 shrink-0"
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 type-meta text-foreground mt-2">
                    <p>ID {displayId}</p>
                    <div className="flex items-center">
                      <IconMapPin className="w-4 h-4 mr-1" />
                      {locationLine}
                    </div>
                    <div className="flex items-center">
                      <IconClockHour4 className="w-4 h-4 mr-1" />
                      {format.dateTime(post.createdat, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                  {product && (
                    <div className="mt-3">
                      <Link
                        href={{
                          pathname: "/product/[brand]/[model]",
                          params: {
                            brand: product.brandSlug,
                            model: product.modelSlug,
                          },
                        }}
                        className="inline-flex items-center gap-1 rounded-sm border border-sky-100 bg-blue-50 px-2 py-1 type-body-sm text-[#00a0e9] hover:underline"
                      >
                        {t("Post.viewFullSpecs")}
                      </Link>
                    </div>
                  )}
                  {post.freeDelivery && (
                    <div className="mt-3">
                      <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-[#00a0e9] type-button-sm rounded-sm border border-blue-100">
                        <Truck className="w-3.5 h-3.5 mr-1" />{" "}
                        {t("Common.freeDelivery")}
                      </span>
                    </div>
                  )}
                  <div className="flex items-end justify-between gap-3 flex-wrap mt-3 pb-4">
                    <div className="flex items-end gap-2.5">
                      <span className="type-price text-[#e3281b]">
                        {post.price === null
                          ? t("Common.negotiable")
                          : `$${post.price}`}
                      </span>
                      {post.oldPrice && (
                        <span className="type-body-sm text-gray-400 line-through mb-0.5">
                          ${post.oldPrice}
                        </span>
                      )}
                      {post.discount && (
                        <span className="type-discount bg-[#fdf0e6] text-[#f68b1e] px-1.5 py-0.5 rounded-sm mb-1">
                          {post.discount}
                        </span>
                      )}
                    </div>
                    {jobApply && (
                      <ApplyJobButton
                        listingId={real.listing.id}
                        listingTitle={real.listing.title}
                        viewerId={viewerId ?? null}
                        posterId={real.listing.userId}
                        resume={jobApply.resume}
                        appliedApplicationId={jobApply.appliedApplicationId}
                      />
                    )}
                  </div>
                </div>
              </div>
              <hr className="border" />
              {/* Description */}
              <div className="p-4">
                <h2 className="type-section-title text-foreground mb-4">
                  {t("Post.description")}
                </h2>
                <ListingSpecs
                  cate={real.cate}
                  subcate={real.subcate}
                  brand={real.brand}
                  model={real.model}
                  attributes={real.listing.attributes}
                  valueLabels={real.valueLabels}
                  condition={real.listing.condition}
                />
                <p className="whitespace-pre-line type-body">
                  {post.description}
                </p>
                <ContactUser
                  user={user}
                  coords={coords}
                  locationLine={fullLocation}
                  addressLine={addressLine}
                  listingId={real.listing.id}
                  contactDisabled={isExpired}
                />
                <div className="border-t border-muted-foreground/20 mt-4" />
                <ThreeButton post={post} viewerId={viewerId} />
              </div>
            </div>
            {/* Disclaimer */}
            <div className="bg-card border-l-3 border-l-[#f68b1e] rounded-r-sm p-4 type-body-sm shadow-sm">
              <h3 className="text-[#f68b1e] type-card-heading mb-2">
                ការមិនទទួលខុសត្រូវ / Disclaimer
              </h3>
              <p className="type-body-sm text-foreground">
                យើងខ្ញុំមិនគ្រប់គ្រងមាតិកា
                ដែលបានបង្ហោះឡើងដោយសមាជិកឡើយ។ដូច្នេះយើងមិនទទួលខុសត្រូវលើការផ្សាយផលិតផលនេះទេ
                ហើយក៏មិនធានាចំពោះបញ្ហាដែលទាក់ទងដោយផ្ទាល់ ឬ ប្រយោលទៅនឹងសកម្មភាព ឬ
                អសកម្មណាមួយឡើយ។
              </p>
              <p className="type-body-sm text-foreground mt-2">
                We does not control the content posted by members and therefore
                assumes no responsibility and disclaims any liability for any
                consequence relating directly or indirectly to any action or
                inaction.
              </p>
            </div>
            {/* Loan Calculator */}
            <LoanCalculator />
            {/* <p className="text-xl font-medium">Related posts</p>
            <div>
                <GridCardPost post={post} />
            </div> */}
          </div>
          {/* Sidebar */}
          <aside className="w-full md:w-[400px] shrink-0">
            <div className="sticky top-20 space-y-2">
              <ProfileSidebar
                userId={post.userId}
                user={user}
                listingId={listingContext.id}
                listing={listingContext}
                viewerId={viewerId}
                initialFollowing={sellerFollowing}
              />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
