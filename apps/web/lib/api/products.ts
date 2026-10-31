import "server-only";
import { API_URL } from "@/lib/api/client";
import type {
  ProductDetail,
  ProductSpecFamily,
  ProductSummary,
} from "@/types/product";

interface Envelope<T> {
  success: boolean;
  data?: T;
}

/**
 * Published product specs. Used by the public search page (top matches) and by
 * the listing post form, which loads the published catalogue for its family to
 * power the "Product Specification" picker and pasted-link resolution.
 * Fail-soft: the caller renders without the section rather than taking the
 * page down.
 */
export async function getProducts(
  q?: string,
  limit = 10,
  family?: ProductSpecFamily,
): Promise<ProductSummary[]> {
  const qs = new URLSearchParams();
  if (q && q.trim()) qs.set("q", q.trim());
  qs.set("limit", String(limit));
  if (family) qs.set("family", family);
  try {
    const res = await fetch(`${API_URL}/products?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as Envelope<ProductSummary[]>;
    return body.success ? (body.data ?? []) : [];
  } catch {
    return [];
  }
}

/** One public spec page; `null` means missing or unpublished (→ 404). */
export async function getProduct(
  brandSlug: string,
  modelSlug: string,
): Promise<ProductDetail | null> {
  try {
    const res = await fetch(
      `${API_URL}/products/${encodeURIComponent(brandSlug)}/${encodeURIComponent(modelSlug)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Envelope<ProductDetail>;
    return body.success ? (body.data ?? null) : null;
  } catch {
    return null;
  }
}
