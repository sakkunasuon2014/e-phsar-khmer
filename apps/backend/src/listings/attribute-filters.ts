/**
 * Multi-attribute filter parsing for the feed's `attrs` query param — one
 * JSON object of `{ attributeKey: value }`, every entry AND'ed by the caller.
 *
 * The More Filters dialog offers one select per attribute the subcategory's
 * `field_schema` declares (storage/RAM/CPU/…), so a single `attrKey`/`attrValue`
 * pair can't express the selection. Malformed or oversized input is ignored
 * rather than rejected: the feed's established rule is that a half/unknown
 * filter applies nothing (see `attrKey` without `attrValue`), never a 500.
 */
const ATTR_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const MAX_ATTRIBUTE_FILTERS = 12;
const MAX_VALUE_LENGTH = 120;

export function parseAttributeFilters(raw?: string): [string, string][] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_ATTRIBUTE_FILTERS) return [];

  const out: [string, string][] = [];
  for (const [key, value] of entries) {
    if (!ATTR_KEY_RE.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim();
    if (!text || text.length > MAX_VALUE_LENGTH) continue;
    out.push([key, text]);
  }
  return out;
}
