"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useRouter } from "@/i18n/routing";
import { followUser, unfollowUser } from "@/actions/follows";

interface FollowButtonProps {
  /** The user being followed. */
  userId: string;
  /** Server-rendered state — authoritative until the first click. */
  initialFollowing: boolean;
  /** The signed-in viewer, or null/undefined when anonymous. */
  viewerId?: string | null;
  /**
   * `profile` is the round header button on a profile; `compact` is the small
   * one on the listing-detail seller card. Only the icons and text differ —
   * the chrome comes from `className` so each call site keeps its own design.
   */
  variant?: "profile" | "compact";
  className?: string;
}

/**
 * The follow toggle. Owns the behaviour only (optimistic state, the action
 * call, rollback, the sign-in bounce); each surface keeps its own styling.
 *
 * Call sites should pass `key={userId}` so moving between profiles resets the
 * optimistic state instead of carrying it over.
 */
export function FollowButton({
  userId,
  initialFollowing,
  viewerId,
  variant = "profile",
  className,
}: FollowButtonProps) {
  const t = useTranslations("Common");
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);

  // Following yourself is not a thing, and the backend refuses it — so the
  // control simply isn't there.
  if (viewerId === userId) return null;

  async function handleClick() {
    if (!viewerId) {
      toast.error(t("signInToFollow"));
      router.push("/login");
      return;
    }

    const next = !following;
    // Optimistic: the toggle IS the interaction, so waiting a round trip to
    // move it reads as broken. Reverted below if the call fails.
    setFollowing(next);
    setPending(true);
    const res = next ? await followUser(userId) : await unfollowUser(userId);
    setPending(false);

    if (!res.success) {
      setFollowing(!next);
      toast.error(res.error ?? t("genericError"));
      return;
    }
    // Re-render the server components so the header's counts stay in step.
    router.refresh();
  }

  return (
    <Button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void handleClick();
      }}
      disabled={pending}
      className={className}
    >
      {variant === "compact" ? (
        following ? (
          <UserCheck className="!w-4 !h-4" />
        ) : (
          <UserPlus className="!w-4 !h-4" />
        )
      ) : following ? (
        <Check className="mr-1 h-4 w-4" />
      ) : (
        <Plus className="mr-1 h-4 w-4" />
      )}
      {variant === "compact" ? (
        <span className="type-meta">
          {following ? t("following") : t("follow")}
        </span>
      ) : (
        <>{following ? t("following") : t("follow")}</>
      )}
    </Button>
  );
}
