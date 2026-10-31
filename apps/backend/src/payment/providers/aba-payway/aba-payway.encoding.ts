/** ABA's "encrypted with Base64" `return_url` is plain base64 (no key). */
export function base64EncodeAbaPaywayUrl(url: string): string {
  return Buffer.from(url, 'utf-8').toString('base64');
}

/** ABA's `req_time`: 14-digit UTC `YYYYMMDDHHmmss`, not epoch millis. */
export function formatAbaPaywayReqTime(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}
