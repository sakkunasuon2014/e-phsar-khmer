"use client";

import {
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconLoader,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";

export type ReportStatus = "pending" | "approved" | "rejected";

const LABEL: Record<ReportStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/** One status badge for both report queues, with the reviewer on a second line. */
export function ReportStatusBadge({
  status,
  reviewerName,
}: {
  status: ReportStatus;
  reviewerName?: string | null;
}) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant="outline" className="flex items-center gap-1">
        {status === "pending" ? (
          <IconLoader strokeWidth={1} className="size-3 animate-spin" />
        ) : null}
        {status === "approved" ? (
          <IconCircleCheckFilled
            strokeWidth={1}
            className="size-3 text-green-500"
          />
        ) : null}
        {status === "rejected" ? (
          <IconCircleXFilled
            strokeWidth={1}
            className="size-3 rounded-full text-red-500"
          />
        ) : null}
        {LABEL[status]}
      </Badge>
      {reviewerName ? (
        <span className="type-meta text-muted-foreground">
          by {reviewerName}
        </span>
      ) : null}
    </div>
  );
}
