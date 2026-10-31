"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/routing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { applyToJob, applyToJobEncrypted } from "@/actions/applications";
import { fetchE2eUserDevices } from "@/actions/e2e";
import { useE2eEngine } from "@/hooks/use-e2e-engine";
import { sendE2eText } from "@/lib/e2e/send-encrypt";

/** What the dialog's résumé card needs — see `getApplyResumeSummary`. */
export interface ApplyResumeSummary {
  hasResume: boolean;
  summary: string | null;
  cvFileName: string | null;
}

const NOTE_MAX = 2000;

/**
 * The chat message an application produces. The line naming the job matters:
 * the poster's thread shows the cover note as an ordinary bubble, and the job
 * is context they may not have open. Composed client-side because the server
 * only ever sees the ciphertext.
 */
function buildApplicationMessage(title: string, coverNote: string): string {
  const headline = `Application for "${title}"`;
  return coverNote ? `${headline}\n\n${coverNote}` : headline;
}

/**
 * The apply form: an optional note, a card saying exactly what résumé will be
 * sent, and one submit.
 *
 * The résumé is not a choice — if the viewer has one it goes with the
 * application, because that is what a job application is. The card exists so
 * that is never a surprise, and it points at `/me/resume` when there is
 * nothing to send (applying without a résumé is allowed; the record simply
 * carries none).
 *
 * The chat copy is encrypted in this browser (`sendE2eText`), exactly like a
 * message sent from the thread: the server stores ciphertext it cannot read.
 * When the poster has no devices registered for encrypted chat there is
 * nobody to encrypt to, so the application is recorded without a chat message
 * and delivered through the poster's applications list instead.
 */
export function ApplyJobDialog({
  open,
  onOpenChange,
  listingId,
  listingTitle,
  viewerId,
  posterId,
  resume,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingId: string;
  listingTitle: string;
  viewerId: string;
  /** The job's owner — the encryption target. */
  posterId: string;
  resume: ApplyResumeSummary | null;
}) {
  const t = useTranslations("Post.apply");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  // Bootstrap only once the dialog opens: browsing a job must not register
  // an E2E device merely for looking at it.
  const engine = useE2eEngine(open ? viewerId : null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  function succeed(message: string) {
    toast.success(message);
    onOpenChange(false);
    setNote("");
    // The button's state is server-rendered, so the new "Applied" face
    // arrives with a refresh rather than a local flag a reload would erase.
    router.refresh();
  }

  function failed(result: { code?: string; message: string }) {
    // 409 gets its own wording: it is the one rejection the applicant can
    // act on (they applied in another tab), and a generic toast would read
    // like a failure of the attempt that just happened.
    toast.error(
      result.code === "JOB_APPLICATION_EXISTS"
        ? t("alreadyApplied")
        : result.message,
    );
  }

  /** Record the application without a chat message (poster has no devices). */
  async function applyWithoutChat(noteText: string) {
    const result = await applyToJob({ listingId, coverNote: noteText });
    if (!result.ok) {
      failed(result);
      return;
    }
    succeed(t("sentWithoutChat"));
  }

  async function submit() {
    if (sending) return;
    setSending(true);
    try {
      const noteText = note.trim();

      // Encrypting to the poster needs at least one of their devices. None:
      // deliver through the applications list instead of blocking the apply.
      // A 403 here is chat's own "Messaging unavailable" (a block either way).
      const devices = await fetchE2eUserDevices(posterId);
      if (!devices.ok && devices.status === 403) {
        toast.error(devices.message);
        return;
      }
      if (devices.ok && devices.data.length === 0) {
        await applyWithoutChat(noteText);
        return;
      }

      if (!engine) {
        toast.error(t("secureChatUnavailable"));
        return;
      }

      // `sendE2eText` keeps only message + status on failure; remember the
      // code so the 409 duplicate still gets its own wording.
      let lastCode: string | undefined;
      const outcome = await sendE2eText(engine, {
        conversationId: null,
        senderId: viewerId,
        recipientId: posterId,
        plaintext: buildApplicationMessage(listingTitle, noteText),
        listingId,
        send: async (input) => {
          const result = await applyToJobEncrypted({
            listingId,
            coverNote: noteText,
            body: input.body,
            e2e: input.e2e,
            e2eHeader: input.e2eHeader,
            recipientIdentityKey: input.recipientIdentityKey,
          });
          lastCode = result.ok ? undefined : result.code;
          return result;
        },
      });

      if (outcome.ok) {
        succeed(t("sent"));
        return;
      }
      if (outcome.reason === "no-recipient-keys") {
        // The poster's last device went inactive between the check and the
        // send — the application can still land without a chat message.
        await applyWithoutChat(noteText);
        return;
      }
      if (outcome.reason === "send-failed") {
        toast.error(
          lastCode === "JOB_APPLICATION_EXISTS"
            ? t("alreadyApplied")
            : outcome.message,
        );
        return;
      }
      toast.error(t("secureChatUnavailable"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("button")}</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {listingTitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="apply-note" className="type-nav text-foreground">
              {t("messageLabel")}{" "}
              <span className="text-muted-foreground font-normal">
                {t("optional")}
              </span>
            </label>
            <Textarea
              id="apply-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              placeholder={t("placeholder")}
              className="min-h-28"
            />
          </div>

          <div className="rounded-sm border bg-muted/40 p-3">
            <div className="flex items-start gap-2">
              <FileText className="size-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 type-body-sm">
                {resume?.hasResume ? (
                  <>
                    <p className="type-nav text-foreground">
                      {t("resumeWillBeSent")}
                    </p>
                    {resume.summary ? (
                      <p className="text-muted-foreground line-clamp-2 mt-0.5">
                        {resume.summary}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground mt-0.5">
                      {resume.cvFileName
                        ? t("cvFile", { file: resume.cvFileName })
                        : t("noCvFile")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="type-nav text-foreground">
                      {t("noResumeTitle")}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {t("noResumeHint")}
                    </p>
                  </>
                )}
                <Link
                  href="/me/resume"
                  className="text-[#00a0e9] hover:underline mt-1 inline-block"
                >
                  {resume?.hasResume ? t("reviewResume") : t("buildResume")}
                </Link>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="cursor-pointer"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={sending}
            className="bg-[#f68b1e] hover:bg-[#e57a10] text-white cursor-pointer"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
