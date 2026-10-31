/**
 * Realtime hint from the backend about the encrypted-history backup (see
 * `apps/backend/src/chat/e2e/e2e-push-events.ts`). It carries ids only and is
 * best-effort: this module only decides *which* ordinary, authenticated read
 * to run sooner. A missed hint is covered by the safety poll and by the
 * catch-up on every socket (re)connect.
 */
export const E2E_PUSH = {
  backupUpdated: "e2e.backup_updated",
} as const;

export type E2ePushAction =
  /** Run the backup sync (upload + pull) now. */
  "pull-backup";

export interface PushNotification {
  type: string;
  data?: Record<string, unknown>;
}

/**
 * `ownDeviceId` is this browser's device. An upload by this device itself never
 * needs a pull; a hint with missing or odd data is treated as coming from
 * elsewhere, because an extra read is cheap and a missed one is not.
 */
export function actionForPush(
  notification: PushNotification,
  ownDeviceId: string,
): E2ePushAction | null {
  if (notification.type !== E2E_PUSH.backupUpdated) return null;
  return notification.data?.deviceId === ownDeviceId ? null : "pull-backup";
}
