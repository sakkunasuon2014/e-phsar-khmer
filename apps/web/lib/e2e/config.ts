/**
 * Multi-device E2E (v2) send path. On by default; set NEXT_PUBLIC_E2E_V2=off
 * to fall back to v1 sends (kill switch — reads of already-sent v2 messages
 * keep working either way, the decrypt path does not consult this flag).
 */
export const E2E_V2_ENABLED = process.env.NEXT_PUBLIC_E2E_V2 !== "off";

/**
 * Encrypted attachments (docs/e2e-attachments.md). On by default; set
 * NEXT_PUBLIC_E2E_ATTACHMENTS=off to disable encrypted media (images, voice
 * notes) entirely. This is a kill switch, not a fallback: new sends are
 * E2E-only, so there is no plaintext public-bucket path to fall back to — with
 * the flag off, media fails closed. Rendering of already-sent encrypted files
 * ignores this flag.
 */
export const E2E_ATTACHMENTS_ENABLED =
  process.env.NEXT_PUBLIC_E2E_ATTACHMENTS !== "off";
