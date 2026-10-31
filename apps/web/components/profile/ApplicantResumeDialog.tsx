"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { getApplication, signApplicationCv } from "@/actions/applications";
import type {
  ApplicationDetail,
  ApplicationResumeSnapshot,
} from "@/types/applications";

/**
 * The poster's read of the résumé an application carried.
 *
 * Read-only and frozen: this renders the snapshot stored on the application
 * row, never the applicant's live CV — that is the whole of the recruiter
 * allow-list, and it is why editing a résumé later cannot rewrite what a
 * poster already read. The CV *file* stays in its private bucket and is only
 * fetched through a signed URL minted for this application's poster.
 */
export function ApplicantResumeDialog({
  applicationId,
  applicantName,
  open,
  onOpenChange,
}: {
  applicationId: string;
  applicantName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Me.applicantResume");
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvGone, setCvGone] = useState(false);

  // Loaded when the dialog opens, not when it renders: the snapshot is a page
  // of JSON nobody asked for until they click, and the CV URL expires in five
  // minutes.
  //
  // The trigger is this effect, not `onOpenChange`: the parent opens the
  // dialog by setting state, and Radix does not fire that callback for a
  // controlled `open` flip — hanging the fetch there left the body spinning
  // forever (caught by the headless walk, not by the types).
  useEffect(() => {
    if (!open || detail || loading) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setCvGone(false);
      const result = await getApplication(applicationId);
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setDetail(result.data);
    })();
    return () => {
      cancelled = true;
    };
    // `loading` is deliberately not a dependency: it flips inside the effect
    // and would re-run it. `detail` gates the re-fetch instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applicationId, detail]);

  async function downloadCv() {
    setCvBusy(true);
    const result = await signApplicationCv(applicationId);
    setCvBusy(false);
    if (!result.ok) {
      // 409 is the applicant having removed or replaced the file since — the
      // résumé text below is still valid, so this is a note, not a failure.
      if (
        result.code === "RESUME_CV_REMOVED" ||
        result.code === "RESUME_CV_MISSING"
      )
        setCvGone(true);
      toast.error(result.message);
      return;
    }
    window.open(result.data.url, "_blank", "noopener");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title", { name: applicantName })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : detail.resume === null ? (
          <p className="py-10 text-center type-body-sm text-muted-foreground">
            {t("noResume")}
          </p>
        ) : (
          <ResumeSnapshotView
            snapshot={detail.resume}
            cvGone={cvGone}
            cvBusy={cvBusy}
            onDownload={() => void downloadCv()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The frozen document, laid out as the applicant filled it in. */
function ResumeSnapshotView({
  snapshot,
  cvGone,
  cvBusy,
  onDownload,
}: {
  snapshot: ApplicationResumeSnapshot;
  cvGone: boolean;
  cvBusy: boolean;
  onDownload: () => void;
}) {
  const t = useTranslations("Me.applicantResume");
  const personal = snapshot.personal;
  const place = personal?.place;
  const location = [
    place?.commune?.name,
    place?.district?.name,
    place?.province?.name,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-5 type-body-sm">
      {personal ? (
        <section>
          <h3 className="type-card-heading text-foreground">
            {personal.firstName} {personal.lastName}
          </h3>
          <p className="text-muted-foreground">
            {[personal.position, snapshot.jobPreference?.position]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <Field label={t("email")} value={personal.email} />
            <Field label={t("phone")} value={personal.phones.join(", ")} />
            <Field label={t("location")} value={location || null} />
            <Field
              label={t("experience")}
              value={
                personal.yearsOfExperience === null
                  ? null
                  : t("years", { count: personal.yearsOfExperience })
              }
            />
            <Field label={t("education")} value={personal.educationLevel} />
            <Field label={t("nationality")} value={personal.nationality} />
          </dl>
        </section>
      ) : null}

      <Block title={t("summary")} body={snapshot.summary} />
      <List
        title={t("experience")}
        rows={snapshot.experiences.map((e) => ({
          id: e.id,
          lead: `${e.position} — ${e.company}`,
          meta: `${e.startDate} → ${e.current ? t("present") : (e.endDate ?? "")}`,
          body: e.description,
        }))}
      />
      <List
        title={t("education")}
        rows={snapshot.educations.map((e) => ({
          id: e.id,
          lead: `${e.degree} — ${e.school}`,
          meta: `${e.startDate} → ${e.current ? t("present") : (e.endDate ?? "")}`,
          body: [e.major, e.description].filter(Boolean).join(" · "),
        }))}
      />
      <List
        title={t("skills")}
        rows={snapshot.skills.map((s) => ({
          id: s.id,
          lead: s.title,
          meta: s.level,
          body: "",
        }))}
      />
      <List
        title={t("languages")}
        rows={snapshot.languages.map((l) => ({
          id: l.id,
          lead: l.title,
          meta: l.level,
          body: "",
        }))}
      />
      <List
        title={t("references")}
        rows={snapshot.references.map((r) => ({
          id: r.id,
          lead: `${r.name} — ${r.company}`,
          meta: r.position,
          body: [r.phones.join(", "), r.email].filter(Boolean).join(" · "),
        }))}
      />
      <Block title={t("hobbies")} body={snapshot.hobbies} />

      {snapshot.attachment ? (
        <section className="rounded-sm border bg-muted/40 p-3">
          <div className="flex items-center gap-3">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">
                {snapshot.attachment.fileName}
              </p>
              <p className="type-meta text-muted-foreground">
                {formatBytes(snapshot.attachment.size)}
              </p>
            </div>
            {cvGone ? (
              <span className="type-meta text-muted-foreground">
                {t("noLongerAvailable")}
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDownload}
                disabled={cvBusy}
                className="cursor-pointer"
              >
                {cvBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {t("download")}
              </Button>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 truncate text-foreground">{value}</dd>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  if (!body?.trim()) return null;
  return (
    <section>
      <h4 className="mb-1 font-semibold text-foreground">{title}</h4>
      <p className="whitespace-pre-line text-foreground/90">{body}</p>
    </section>
  );
}

function List({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; lead: string; meta: string; body: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h4 className="mb-2 font-semibold text-foreground">{title}</h4>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="border-l-2 border-muted pl-3">
            <p className="font-medium text-foreground">{row.lead}</p>
            {row.meta ? (
              <p className="type-meta text-muted-foreground">{row.meta}</p>
            ) : null}
            {row.body ? (
              <p className="mt-0.5 whitespace-pre-line text-foreground/90">
                {row.body}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
