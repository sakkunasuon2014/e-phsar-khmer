export type Post = {
  postId: number | string;
  userId: string;
  /**
   * The seller's handle, when the card came from the real feed (`GET /listings`
   * joins it on). Surfaces must not invent one from the contact name.
   */
  sellerUsername?: string | null;
  /**
   * The seller holds an active paid subscription — the "Verified Account"
   * badge. Only the real feed/detail rows carry it.
   */
  sellerVerifiedAccount?: boolean;
  title: string;
  images: string[];
  imageCount?: number;
  /**
   * `null` means the listing genuinely has no price — its subcategory's
   * `field_schema` declares no `price` key at all (Properties Wanted, Agent
   * Services, Others). The surfaces print **"Negotiable"** for it rather than
   * a fabricated `$0`. Do not coalesce it to 0 in an adapter: that is exactly
   * what made a wanting-to-buy ad advertise a $0 price (captain, 2026-09-23).
   */
  price: number | null;
  cateId: string;
  subId: string;
  brandId?: string;
  modelId?: string;
  bodyTypeId?: string;
  jobTypeId?: string;
  yearId?: string;
  engineId?: string;
  transmissionId?: string;
  colorId?: string;
  conditionId?: string;
  taxTypeId?: string;
  facingId?: string;
  networkId?: string;
  storageId?: string;
  screenSizeId?: string;
  video?: boolean;
  ramId?: string;
  cpuId?: string;
  vgaId?: string;
  accessoryId?: string;
  bedRoomId?: string;
  bathRoomId?: string;
  experienceId?: string;
  discountId?: string;
  oldPrice?: number;
  discount?: string;
  description: string;
  createdat: Date;
  proId: string;
  disId: string;
  condition?: string;
  freeDelivery?: boolean;
  /**
   * Location line for backend listings — overrides proId/disId. `toCardPost`
   * fills it with the short `district, province` (`shortLocation`), never the
   * address: the card has no room for it.
   */
  location?: string;
  /**
   * Real listings only: the like count `GET /listings/:id` carries, seeding
   * the detail page's "N Likes" control before the first toggle.
   */
  likeCount?: number;
  /**
   * Real listings, Manage Ads only: whole days until the 30-day window
   * closes, computed server-side by `getMyAdsPage` (a client render must not
   * read the clock). Negative once the ad has lapsed.
   */
  expiresInDays?: number;
};
