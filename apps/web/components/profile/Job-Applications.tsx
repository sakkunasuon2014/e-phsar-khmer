"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { FileUser } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "../ui/button";
import { Link } from "@/i18n/routing";
import { JobApplicationRow } from "./JobApplicationRow";
import { ApplicantResumeDialog } from "./ApplicantResumeDialog";
import { ContactSellerButton } from "@/components/chat/contact-seller-button";
import { loadMyReceivedApplications } from "@/actions/applications";
import type { ReceivedApplication } from "@/types/applications";

/**
 * `/me/job-applications` — applications to this account's job listings.
 *
 * The row is the workflow, and the workflow is conversation: open the résumé
 * (which is also what marks the application viewed, server-side) or continue
 * in chat — the thread already exists, because the application *was* the first
 * message. There is deliberately no hire/reject action here: the decision
 * belongs to the recruiter/interviewer in the conversation, not to a button
 * that flips a status.
 */
export default function JobApplications() {
  const t = useTranslations("Me.jobsPage");
  const tCommon = useTranslations("Common");
  const [sort, setSort] = React.useState<"newest" | "oldest">("newest");
  const [items, setItems] = React.useState<ReceivedApplication[] | null>(null);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resumeFor, setResumeFor] = React.useState<ReceivedApplication | null>(
    null,
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setItems(null);
      const result = await loadMyReceivedApplications({ page: 1 });
      if (cancelled) return;
      setItems(result.items);
      setHasMore(result.hasMore);
      setError(result.error ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    void (async () => {
      const next = page + 1;
      const result = await loadMyReceivedApplications({ page: next });
      setLoadingMore(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPage(next);
      setHasMore(result.hasMore);
      setItems((current) => [
        ...(current ?? []),
        ...result.items.filter(
          (row) => !(current ?? []).some((seen) => seen.id === row.id),
        ),
      ]);
    })();
  };

  const rows = React.useMemo(() => {
    const list = [...(items ?? [])];
    list.sort((a, b) => {
      const at = Date.parse(a.createdAt);
      const bt = Date.parse(b.createdAt);
      return sort === "newest" ? bt - at : at - bt;
    });
    return list;
  }, [items, sort]);

  return (
    <div className="min-w-full bg-muted pb-50 pt-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="type-page-title text-foreground mb-6">{t("title")}</h1>
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
          <div className="flex items-center">
            <Tabs defaultValue="applications">
              <TabsList variant="line">
                <TabsTrigger value="applications" className="asChild">
                  <Link href={{ pathname: "/me/job-applications" }}>
                    {t("applications")}
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="applied" className="asChild">
                  <Link href={{ pathname: "/me/applied-jobs" }}>
                    {t("applied")}
                  </Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-3">
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as "newest" | "oldest")}
            >
              <SelectTrigger className="w-[180px] bg-card">
                <SelectValue placeholder={t("sortNewest")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest" className="cursor-pointer">
                  {t("sortNewest")}
                </SelectItem>
                <SelectItem value="oldest" className="cursor-pointer">
                  {t("sortOldest")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <main className="max-w-2xl mx-auto mt-4">
            <div className="bg-card rounded-sm shadow-sm min-h-[240px] flex flex-col items-center justify-center p-8 text-center">
              <h2 className="type-section-title text-foreground mb-2">
                {t("loadFailed")}
              </h2>
              <p className="text-muted-foreground type-body-sm">{error}</p>
            </div>
          </main>
        ) : items === null ? (
          <main className="max-w-2xl mx-auto mt-4">
            <div className="bg-card rounded-sm shadow-sm min-h-[240px]" />
          </main>
        ) : rows.length === 0 ? (
          <main className="max-w-2xl mx-auto mt-4">
            <div className="bg-card rounded-sm shadow-sm min-h-[450px] flex flex-col items-center justify-center p-8">
              <div className="w-32 h-32 bg-muted rounded-full flex items-center justify-center mb-8">
                <div className="relative">
                  <FileUser
                    className="w-12 h-12 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>
              </div>

              <div className="text-center">
                <h2 className="type-section-title text-foreground mb-2">
                  {t("noResult")}
                </h2>
                <p className="text-muted-foreground type-body-sm mb-8">
                  {t("noApplications")}
                </p>
              </div>
            </div>
          </main>
        ) : (
          <main className="w-full">
            <div className="bg-card rounded-sm shadow-sm px-6 py-2">
              <ul>
                {rows.map((row) => {
                  const name =
                    [
                      row.applicant.username
                        ? `@${row.applicant.username}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("") || t("applicant");
                  return (
                    <JobApplicationRow
                      key={row.id}
                      view="received"
                      listing={row.listing}
                      createdAt={row.createdAt}
                      title={name}
                      subtitle={row.listing.company}
                      avatarUrl={row.applicant.profilePhotoUrl}
                      note={row.coverNote}
                      chips={
                        row.resume.hasResume ? (
                          <>
                            <Chip>
                              {t("resumeChip")}
                              {row.resume.cv
                                ? ` · ${row.resume.cv.fileName}`
                                : ""}
                            </Chip>
                            {!row.resume.cv ? (
                              <Chip muted>{t("noCv")}</Chip>
                            ) : null}
                          </>
                        ) : (
                          <Chip muted>{t("noResume")}</Chip>
                        )
                      }
                      actions={
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setResumeFor(row)}
                            className="cursor-pointer"
                          >
                            <FileUser className="size-4" />
                            {t("viewResume")}
                          </Button>
                          <ContactSellerButton
                            sellerId={row.applicant.id}
                            label={t("message")}
                            size="sm"
                            variant="outline"
                            className="cursor-pointer"
                          />
                        </>
                      }
                    />
                  );
                })}
              </ul>
            </div>
            {hasMore ? (
              <div className="flex justify-center pt-6">
                <Button
                  onClick={loadMore}
                  disabled={loadingMore}
                  variant="outline"
                  className="cursor-pointer"
                >
                  {loadingMore ? tCommon("loading") : tCommon("loadMore")}
                </Button>
              </div>
            ) : null}
          </main>
        )}
      </div>

      {resumeFor ? (
        <ApplicantResumeDialog
          applicationId={resumeFor.id}
          applicantName={
            resumeFor.applicant.username
              ? `@${resumeFor.applicant.username}`
              : t("applicant")
          }
          open={resumeFor !== null}
          onOpenChange={(open) => {
            if (!open) setResumeFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Chip({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 type-meta ${
        muted
          ? "border-border bg-muted text-muted-foreground"
          : "border-blue-100 bg-blue-50 text-[#00a0e9]"
      }`}
    >
      {children}
    </span>
  );
}
