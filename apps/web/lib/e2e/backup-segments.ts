/**
 * Opens a page of backup segments, tolerating the ones that cannot be opened.
 *
 * Kept free of crypto imports (the opener is injected) so it runs under
 * `node --test` like the other `lib/**` units.
 *
 * Callers validate the backup key against the account's `keyCheck` first, so
 * a segment this key cannot open is under some other key (an upload from
 * before that check existed) or corrupt. It will never open here, so it is
 * skipped and counted. Stopping at it instead would hide every readable
 * segment after it, on this pull and on every later one.
 */
export function openSegments<T>(
  segments: readonly { ciphertext: string }[],
  open: (ciphertext: string) => T[],
): { items: T[]; skipped: number } {
  const items: T[] = [];
  let skipped = 0;
  for (const segment of segments) {
    try {
      items.push(...open(segment.ciphertext));
    } catch {
      skipped += 1;
    }
  }
  return { items, skipped };
}
