/**
 * Real listings carry UUID ids; legacy mock cards (the non-UUID detail
 * slugs) carry numeric ids and have no row behind them. Controls render on
 * both, so callers use this guard to keep a mock id inert — without it a demo
 * heart or a tracking batch fires a real request for an id that cannot exist.
 */
const LISTING_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isListingUuid(id: string): boolean {
  return LISTING_UUID.test(id);
}
