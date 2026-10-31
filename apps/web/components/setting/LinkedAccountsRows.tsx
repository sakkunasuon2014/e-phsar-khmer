"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { ChevronRight, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { startSocialLink, unlinkSocialProvider } from "@/actions/social";
import { useRouter } from "@/i18n/routing";
import type { SettingsUser } from "@/lib/auth/current-user";
import type { LinkedAuthProvider, SocialProvider } from "@/lib/auth/social";
import {
  SOCIAL_CLOSE_POLL_MS,
  SOCIAL_LINK_POPUP_NAME,
  SOCIAL_POPUP_FEATURES,
} from "@/lib/auth/social";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

const ROW_CLASS =
  "flex w-full items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border text-left";

const PROVIDERS: { provider: LinkedAuthProvider; label: string }[] = [
  { provider: "facebook", label: "Facebook" },
  { provider: "google", label: "Google" },
  { provider: "telegram", label: "Telegram" },
];

/**
 * The Facebook / Google / Telegram rows on the settings hub and rail. Google
 * and Facebook can be linked (popup, then a remove dialog); Telegram is
 * display/remove only until its Login Widget ships. The parent keeps the
 * separator that follows this block.
 */
export function LinkedAccountsRows({ me }: { me?: SettingsUser | null }) {
  const router = useRouter();
  const locale = useLocale();
  const linked = new Set(me?.authProviders ?? []);

  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<LinkedAuthProvider | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const closePoll = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closePoll.current !== null) {
        window.clearInterval(closePoll.current);
        closePoll.current = null;
      }
    };
  }, []);

  async function startLink(provider: SocialProvider) {
    setPending(provider);

    // Opened synchronously in the click handler so the browser allows it.
    const popup = window.open(
      "about:blank",
      SOCIAL_LINK_POPUP_NAME,
      SOCIAL_POPUP_FEATURES,
    );

    try {
      const result = await startSocialLink(provider, locale);

      if (!result.success) {
        popup?.close();
        setPending(null);
        toast.error(result.error);
        return;
      }

      // Popup blocked: the callback's nonce makes the full-page flow safe.
      if (!popup) {
        window.location.assign(result.url);
        return;
      }
      if (popup.closed) {
        setPending(null);
        return;
      }

      popup.location.href = result.url;

      if (closePoll.current !== null) window.clearInterval(closePoll.current);
      closePoll.current = window.setInterval(() => {
        if (!popup.closed) return;
        if (closePoll.current !== null) {
          window.clearInterval(closePoll.current);
          closePoll.current = null;
        }
        setPending(null);
      }, SOCIAL_CLOSE_POLL_MS);
    } catch {
      popup?.close();
      setPending(null);
      toast.error("Could not start connecting that account.");
    }
  }

  function choose(provider: LinkedAuthProvider) {
    if (linked.has(provider)) {
      setUnlinkTarget(provider);
      return;
    }
    if (provider === "telegram") {
      toast("Telegram sign-in isn't available yet.");
      return;
    }
    void startLink(provider);
  }

  async function remove() {
    if (!unlinkTarget || removing) return;
    setRemoving(true);

    const result = await unlinkSocialProvider(unlinkTarget);
    if (!result.success) {
      toast.error(result.error);
      setRemoving(false);
      return;
    }

    toast.success("Connection removed.");
    setUnlinkTarget(null);
    setRemoving(false);
    router.refresh();
  }

  const targetLabel =
    PROVIDERS.find((item) => item.provider === unlinkTarget)?.label ??
    unlinkTarget ??
    "";

  return (
    <>
      {PROVIDERS.map(({ provider, label }, index) => {
        const isLinked = linked.has(provider);
        return (
          <Fragment key={provider}>
            <button
              type="button"
              onClick={() => choose(provider)}
              disabled={pending !== null}
              className={ROW_CLASS}
            >
              <p className="px-1">{label}</p>
              <p className="flex items-center gap-1 opacity-50">
                {isLinked ? "Linked" : "Add"}
                {pending === provider ? (
                  <Loader2Icon className="h-5 w-5 animate-spin" />
                ) : (
                  <ChevronRight size={24} className="text-gray-300" />
                )}
              </p>
            </button>
            {index < PROVIDERS.length - 1 ? <Separator /> : null}
          </Fragment>
        );
      })}

      <Dialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {targetLabel}?</DialogTitle>
            <DialogDescription>
              You will no longer be able to sign in with this provider.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnlinkTarget(null)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void remove()}
              disabled={removing}
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
