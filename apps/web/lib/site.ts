/**
 * Canonical public site identity. Share links, QR codes, metadata and contact
 * copy read from here so a domain change is one edit.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://phsarkhmer.com";

export const CONTACT_EMAIL = "info@phsarkhmer.com";
