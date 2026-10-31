/**
 * Realtime hint for the encrypted-history backup, sent to the user's open tabs
 * as `notification` frames (see `ChatPushEvent`). It exists so a tab does not
 * have to poll for "a new segment landed".
 *
 * A hint carries ids only, never ciphertext, wrapped keys or plaintext, and the
 * receiver always re-reads through the authenticated routes. It is best-effort:
 * a missed hint is recovered by the client's safety poll and its catch-up on
 * every (re)connect.
 */
export const E2E_PUSH = {
  /** A device uploaded a segment: `{ deviceId }`. */
  backupUpdated: 'e2e.backup_updated',
} as const;

export type E2ePushType = (typeof E2E_PUSH)[keyof typeof E2E_PUSH];
