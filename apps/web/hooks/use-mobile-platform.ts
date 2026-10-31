import { useSyncExternalStore } from "react";

export type MobilePlatform = "ios" | "android" | "other";

// The DEVICE, not the viewport (that is `use-mobile.ts`): a deeplink into a
// banking app only makes sense on a phone/tablet, whatever its width — a
// narrow desktop window has no app to open.
export function detectMobilePlatform(): MobilePlatform | null {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports a desktop Mac UA; touch points give it away.
  if (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/Android/i.test(ua)) return "android";
  const uaData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData;
  if (uaData?.mobile || /Mobi/i.test(ua)) return "other";
  return null;
}

const subscribe = () => () => {};

/** `null` on the server and on desktop; the device never changes mid-session. */
export function useMobilePlatform(): MobilePlatform | null {
  return useSyncExternalStore(subscribe, detectMobilePlatform, () => null);
}
