"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { Briefcase } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import DbImage from "@/components/common/DbImage";
import { formatPrice } from "@/lib/chat/format";
import type { ApplicationListing } from "@/types/applications";

/**
 * One row of either /me job list. The two sides lead with different things —
 * a seeker reads the job, a poster reads the applicant — so the caller passes
 * what leads and this renders the shared shape: leading block, headline,
 * second line, meta line, chips, actions. There is deliberately no status
 * pill: the application workflow is the chat thread, not a hired/rejected
 * state machine.
 */
export function JobApplicationRow({
  view,
  listing,
  createdAt,
  title,
  subtitle,
  avatarUrl,
  note,
  chips,
  actions,
}: {
  view: "applied" | "received";
  listing: ApplicationListing;
  /** ISO — when the application was sent. */
  createdAt: string;
  /** The headline: the job title (seeker) or the applicant's name (poster). */
  title: string;
  subtitle?: string | null;
  /** Poster's row only: the applicant's photo, when they have one. */
  avatarUrl?: string | null;
  /** Poster's row only: the cover note, clipped. */
  note?: string | null;
  /** Poster's row only: résumé / CV chips. */
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useTranslations("Me.jobsPage");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const price = formatPrice(listing.price, listing.currency, locale);
  const jobGone = listing.title === "";
  const jobLine = jobGone ? (
    <span className="italic">{t("noLongerAvailable")}</span>
  ) : (
    <Link
      // The object form, not the pretty `/<slug>-adid-<id>` string every card
      // uses: only declared pathnames type-check, and the detail route accepts
      // a bare id (the publish flow already routes to `/post/<id>`).
      href={{ pathname: "/post/[slug]", params: { slug: listing.id } }}
      className="truncate text-[#00a0e9] hover:underline"
    >
      {listing.title}
    </Link>
  );

  return (
    <li className="flex flex-col gap-3 border-b border-border/50 px-1 py-4 last:border-b-0 hover:bg-muted/40 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {view === "received" ? (
          avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={title}
              width={44}
              height={44}
              unoptimized
              className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted type-nav text-muted-foreground">
              {/* A poster's row leads with a handle — the initial is the first
                  letter of the name, not the "@" in front of it. */}
              {title.replace(/^@/, "").slice(0, 1).toUpperCase()}
            </div>
          )
        ) : (
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm border border-border bg-muted">
            <DbImage
              src={listing.thumbnailUrl ?? ""}
              alt={title}
              fill
              className="object-cover"
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <Briefcase
                    className="h-6 w-6 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>
              }
            />
          </div>
        )}

        <div className="min-w-0">
          {!jobGone && view === "applied" ? (
            <Link
              href={{ pathname: "/post/[slug]", params: { slug: listing.id } }}
              className="block truncate type-nav text-foreground hover:text-[#00a0e9]"
            >
              {title}
            </Link>
          ) : (
            <p className="truncate type-nav text-foreground">{title}</p>
          )}
          {subtitle ? (
            <p className="truncate type-meta text-muted-foreground">
              {subtitle}
            </p>
          ) : null}

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 type-meta text-muted-foreground">
            {view === "received" ? (
              <>
                {jobLine}
                {listing.company ? <span>{listing.company}</span> : null}
              </>
            ) : price ? (
              <span className="font-medium text-[#e3281b]">{price}</span>
            ) : (
              <span>{tCommon("negotiable")}</span>
            )}
            <span className="whitespace-nowrap">
              {t("appliedAt", {
                date: new Date(createdAt).toLocaleDateString(locale),
              })}
            </span>
          </p>

          {note ? (
            <p className="mt-2 line-clamp-2 type-meta text-foreground/80">
              {note}
            </p>
          ) : null}
          {chips ? (
            <div className="mt-2 flex flex-wrap gap-2">{chips}</div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </li>
  );
}
