/** Shared vocabulary for the admin subscription pages (client-safe). */

export const TIERS = ["bronze", "silver", "gold"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

export const TERM_MONTHS = [3, 6, 12] as const;

/** 12 stored months display as "1 Year"; everything else is "N Months". */
export function termLabel(months: number): string {
  return months === 12 ? "1 Year" : `${months} Months`;
}

/** The price after the term's discount, rounded to cents. */
export function finalPrice(
  price: string,
  discount: string,
  type: string,
): number {
  const base = Number(price);
  const value = Number(discount);
  const result = type === "percent" ? base * (1 - value / 100) : base - value;
  return Math.max(0, Math.round(result * 100) / 100);
}

/** "-20%" / "-$5"; null when there is no positive discount. */
export function discountLabel(discount: string, type: string): string | null {
  const value = Number(discount);
  if (!(value > 0)) return null;
  return type === "percent" ? `-${value}%` : `-$${value}`;
}
