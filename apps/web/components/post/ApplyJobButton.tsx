"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { ApplyJobDialog } from "./ApplyJobDialog";
import type { ApplyResumeSummary } from "./ApplyJobDialog";
import { trackEvent } from "@/lib/insights/queue";

/**
 * "Apply For This Job" — the job detail page's one orange call to action.
 *
 * Four states, all decided by the host page so this component never guesses:
 * already applied (a link to the list, not a button), signed out (a toast plus
 * the login redirect `ContactSellerButton` uses), signed in (the dialog), and
 * hidden entirely — the host renders nothing for your own listing or a closed
 * job, which is what keeps apply from ever being present-but-refused.
 */
export function ApplyJobButton({
  listingId,
  listingTitle,
  viewerId,
  posterId,
  resume,
  appliedApplicationId,
  className,
}: {
  listingId: string;
  listingTitle: string;
  viewerId: string | null;
  /** The job's owner — the apply message's encryption target. */
  posterId: string;
  /** The viewer's own résumé, for the dialog's card; null when it failed to load. */
  resume: ApplyResumeSummary | null;
  /** Set when this viewer already applied — the button becomes a way back to it. */
  appliedApplicationId: string | null;
  className?: string;
}) {
  const t = useTranslations("Post.apply");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (appliedApplicationId)
    return (
      <Button
        type="button"
        disabled
        className={`bg-muted text-muted-foreground h-10 px-5 rounded-sm cursor-default ${className ?? ""}`}
      >
        {t("applied")}
      </Button>
    );

  function openOrSignIn() {
    // The metric is the click on Apply — the signed-out bounce counts too.
    trackEvent(listingId, "apply_job");
    if (!viewerId) {
      toast.error(t("signIn"));
      startTransition(() => router.push("/login"));
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        onClick={openOrSignIn}
        disabled={pending}
        className={`bg-[#f68b1e] hover:bg-[#e57a10] text-white h-10 px-5 rounded-sm transition-colors cursor-pointer ${className ?? ""}`}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("button")}
      </Button>
      {viewerId ? (
        <ApplyJobDialog
          open={open}
          onOpenChange={setOpen}
          listingId={listingId}
          listingTitle={listingTitle}
          viewerId={viewerId}
          posterId={posterId}
          resume={resume}
        />
      ) : null}
    </>
  );
}
