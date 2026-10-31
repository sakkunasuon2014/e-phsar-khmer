"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { completeSocialLink, completeSocialLogin } from "@/actions/social";
import { getDeviceIdentity } from "@/lib/device";
import type { SocialCallbackMode, SocialProvider } from "@/lib/auth/social";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface SocialCallbackProps {
  provider: SocialProvider;
  /** `link` completes in the settings flow; `user`/`admin` log in. */
  mode: SocialCallbackMode;
  /** The per-flow nonce carried in the link callback path. */
  nonce?: string;
  /** The locale segment to return to after a user login. */
  locale?: string;
  /** Where the error state sends the visitor back to. */
  loginHref: string;
}

/** Drops the URL fragment without discarding Next's router state. */
function stripFragment(): void {
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
}

/**
 * Supabase's implicit flow returns the access token in the URL fragment,
 * which only the browser can read — hence a client component. The fragment is
 * stripped before the token is exchanged, and `completeSocialLogin` is the
 * only place that writes session cookies.
 */
export function SocialCallback({
  provider,
  mode,
  nonce,
  locale,
  loginHref,
}: SocialCallbackProps) {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Next's router re-applies the URL it hydrated with, which restores the
  // fragment after the immediate strip below. A deferred strip is the one
  // that sticks, so the token never stays in the address bar/history.
  useEffect(() => {
    const timer = window.setTimeout(stripFragment, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    // React StrictMode mounts effects twice in development; one exchange only.
    if (started.current) return;
    started.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);

    // Best-effort immediate strip; the deferred effect above is authoritative.
    stripFragment();

    const callbackError =
      fragment.get("error_description") ??
      query.get("error_description") ??
      fragment.get("error") ??
      query.get("error");
    const accessToken =
      fragment.get("access_token") ?? query.get("access_token");

    void (async () => {
      const isLink = mode === "link";
      if (callbackError) {
        setError(
          isLink
            ? "The connection was cancelled or could not be completed."
            : "Sign-in was cancelled or could not be completed.",
        );
        return;
      }
      if (!accessToken) {
        setError(
          isLink
            ? "No connection token was returned. Please try again."
            : "No sign-in token was returned. Please try again.",
        );
        return;
      }

      try {
        const result =
          mode === "link"
            ? await completeSocialLink({
                provider,
                accessToken,
                nonce: nonce ?? "",
                locale,
              })
            : await completeSocialLogin({
                provider,
                target: mode,
                accessToken,
                locale,
                device: getDeviceIdentity(),
              });

        if (result.success) {
          // Full navigation: the new httpOnly cookies must be on the very
          // next request, and the admin root layout reads `admin_locale`
          // server-side (a client-side push would keep the old layout data).
          // When this page runs in the OAuth popup, finish in the opener and
          // close the popup instead.
          if (window.opener && !window.opener.closed) {
            try {
              window.opener.location.replace(result.redirectTo);
              window.close();
              return;
            } catch {
              /* cross-origin opener — fall through to same-window navigation */
            }
          }
          window.location.replace(result.redirectTo);
          return;
        }

        setError(result.error);
      } catch {
        setError(
          isLink
            ? "Could not connect that account. Please try again."
            : "Sign-in failed. Please try again.",
        );
      }
    })();
  }, [provider, mode, nonce, locale]);

  return (
    <Card className="overflow-hidden p-0 bg-card rounded-sm">
      <CardContent className="flex flex-col items-center gap-4 p-6 text-center md:p-8">
        {error ? (
          <>
            <h1 className="type-page-title">
              {mode === "link"
                ? "Could not connect that account"
                : "Sign-in failed"}
            </h1>
            <p className="type-body-sm text-muted-foreground">{error}</p>
            <Button
              className="h-10 w-full rounded-sm"
              onClick={() => {
                // A popup closes (the opener re-enables on its close poll); a
                // normal tab closes nothing and navigates back instead.
                window.close();
                window.setTimeout(() => {
                  window.location.href = loginHref;
                }, 50);
              }}
            >
              {mode === "link" ? "Back to settings" : "Back to login"}
            </Button>
          </>
        ) : (
          <>
            <Loader2Icon className="h-8 w-8 animate-spin text-[#00a0e9]" />
            <h1 className="type-page-title">
              {mode === "link" ? "Connecting your account…" : "Signing you in…"}
            </h1>
            <p className="type-body-sm text-muted-foreground">
              This will only take a moment.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
