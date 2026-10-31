/**
 * Shared device-id contract between the browser writer (`lib/device.ts`) and
 * the server readers (session helpers, refresh, the devices page).
 *
 * The id is deliberately not a secret: it only lets the backend group logins
 * by browser profile. The cookie is non-httpOnly so the client can mirror the
 * localStorage value into it; the server can then forward it on the requests
 * whose browser context it would otherwise not see (RSC fetch, token refresh).
 */
export const DEVICE_ID_COOKIE = "phsarkhmer_device_id";

/** Pre-rebrand cookie. Read once, then expired by lib/device.ts. */
export const LEGACY_DEVICE_ID_COOKIE = "psa_device_id";

/** Mirrors the backend's `readClientDevice` validation. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** One year. */
export const DEVICE_ID_MAX_AGE = 60 * 60 * 24 * 365;
