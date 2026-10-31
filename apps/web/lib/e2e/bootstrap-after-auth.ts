import { getE2eEngine } from "./engine-provider";

/** Backoff between attempts after a failure (ms); gives up after the last. */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

/**
 * Register this browser as an E2E device as part of signing in, instead of
 * as a side effect of whichever layout renders next. Call it right after a
 * login, OTP verify or registration succeeds (the session cookies are set by
 * then). Fire-and-forget: navigation must not wait for key generation.
 *
 * getE2eEngine caches one promise per account, so the layout's
 * E2eBackupProvider / useE2eEngine — still the safety net, with its own
 * retries — picks up this bootstrap instead of starting a second one.
 */
export function bootstrapE2eAfterAuth(userId: string): void {
  let failures = 0;
  const attempt = () => {
    getE2eEngine(userId).catch((err: unknown) => {
      if (failures >= RETRY_DELAYS_MS.length) {
        console.warn(
          "[e2e] post-login bootstrap failed; leaving it to the provider",
          err,
        );
        return;
      }
      setTimeout(attempt, RETRY_DELAYS_MS[failures]);
      failures += 1;
    });
  };
  attempt();
}
