import "server-only";
import { API_URL } from "@/lib/api/client";

export type AdvertisementPlacement =
  | "home"
  | "all_ads"
  | "category"
  | "subcategory"
  | "listing_detail";

/** One storefront banner as the public API returns it. */
export interface AdvertisementCard {
  id: string;
  placement: AdvertisementPlacement;
  imageUrl: string;
  linkUrl: string | null;
  altText: string;
  sortOrder: number;
}

type Envelope<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

/**
 * Active banners for one placement, in display order.
 *
 * Fail-soft like the rest of `lib/api/categories.ts`: any failure becomes an
 * empty list, so a banner outage renders nothing instead of taking down the
 * page around it.
 */
export async function getAdvertisements(
  placement: AdvertisementPlacement,
): Promise<AdvertisementCard[]> {
  try {
    const res = await fetch(
      `${API_URL}/advertisements?placement=${encodeURIComponent(placement)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as Envelope<AdvertisementCard[]>;
    return body.success ? (body.data ?? []) : [];
  } catch {
    return [];
  }
}
