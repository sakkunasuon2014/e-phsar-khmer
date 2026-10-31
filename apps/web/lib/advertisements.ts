/**
 * Shared advertisement types and the placement list.
 *
 * Deliberately NOT in `actions/advertisements.ts`: a `"use server"` module may
 * only export async functions, so a constant living there fails at runtime
 * with "Only async functions are allowed to be exported in a 'use server'
 * file" — which surfaces in the dashboard as the generic error boundary.
 */
export type AdvertisementPlacement =
  | "home"
  | "all_ads"
  | "category"
  | "subcategory"
  | "listing_detail";

/** The five storefront slots, in the order the dashboard lists them. */
export const ADVERTISEMENT_PLACEMENTS: {
  value: AdvertisementPlacement;
  label: string;
}[] = [
  { value: "home", label: "Home page" },
  { value: "all_ads", label: "All ads" },
  { value: "category", label: "Category page" },
  { value: "subcategory", label: "Subcategory page" },
  { value: "listing_detail", label: "Listing detail" },
];

export interface AdminAdvertisement {
  id: string;
  placement: AdvertisementPlacement;
  imageUrl: string;
  imagePath: string;
  linkUrl: string | null;
  altText: string;
  sortOrder: number;
  isActive: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdvertisementInput {
  placement: AdvertisementPlacement;
  imagePath: string;
  linkUrl?: string;
  altText?: string;
  sortOrder?: number;
  isActive?: boolean;
}
