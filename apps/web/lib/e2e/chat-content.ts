/**
 * Small structured content that still travels only inside an E2E-encrypted
 * message body. The marker/version keep legacy plaintext strings and old
 * attachment JSON unambiguous.
 */
const CONTENT_MARKER = "khmer24-chat-content";
const CONTENT_VERSION = 1;

export interface SharedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export type StructuredChatContent =
  | { kind: "location"; location: SharedLocation }
  | { kind: "listing" };

function isValidLocation(value: unknown): value is SharedLocation {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  if (
    typeof point.latitude !== "number" ||
    !Number.isFinite(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    typeof point.longitude !== "number" ||
    !Number.isFinite(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180
  )
    return false;
  if (point.accuracyMeters !== undefined) {
    if (
      typeof point.accuracyMeters !== "number" ||
      !Number.isFinite(point.accuracyMeters) ||
      point.accuracyMeters < 0 ||
      point.accuracyMeters > 200_000
    )
      return false;
  }
  return true;
}

export function encodeLocationContent(location: SharedLocation): string {
  if (!isValidLocation(location)) throw new Error("Invalid location");
  return JSON.stringify({
    marker: CONTENT_MARKER,
    version: CONTENT_VERSION,
    kind: "location",
    location,
  });
}

export function encodeListingOnlyContent(): string {
  return JSON.stringify({
    marker: CONTENT_MARKER,
    version: CONTENT_VERSION,
    kind: "listing",
  });
}

/** Returns null for ordinary text, legacy content, or malformed structured data. */
export function parseStructuredChatContent(
  plaintext: string,
): StructuredChatContent | null {
  try {
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    if (value.marker !== CONTENT_MARKER || value.version !== CONTENT_VERSION)
      return null;
    if (value.kind === "listing") return { kind: "listing" };
    if (value.kind === "location" && isValidLocation(value.location))
      return { kind: "location", location: value.location };
    return null;
  } catch {
    return null;
  }
}
