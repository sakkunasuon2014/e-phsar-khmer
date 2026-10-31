"use client";

import { useMemo, useState } from "react";
import { Eye, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListingReports,
  updateListingReportStatus,
  type ListingReportView,
} from "@/actions/admin-reports";
import { toast } from "@/components/ui/sonner";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminSearch,
  AdminTable,
  DateCell,
  PrimaryCell,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";
import { ReportStatusBadge } from "@/components/dashboard/report-status-badge";

/** The public detail route reads the id after `-adid-`; the title is cosmetic. */
function postHref(report: ListingReportView): string {
  const title = (report.listingTitle ?? "listing")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${encodeURIComponent(title)}-adid-${report.listingId}`;
}

export default function ReportPostsPage() {
  const queryClient = useQueryClient();
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["admin", "reports", "listings"],
    queryFn: getListingReports,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["admin", "reports", "listings"],
    });

  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState("all");
  const router = useRouter();
  const locale = useLocale();

  const updateStatus = async (id: string, status: "approved" | "rejected") => {
    if (
      status === "approved" &&
      !window.confirm(
        "Approving takes this listing down (you can restore it from Listings). Continue?",
      )
    )
      return;
    const res = await updateListingReportStatus(id, status);
    if (res.success) {
      refresh();
      toast.success(`Report ${status}`);
    } else {
      toast.error(res.error ?? "Update failed");
    }
  };

  const counts = useMemo(
    () => ({
      pending: reports.filter((report) => report.status === "pending").length,
      approved: reports.filter((report) => report.status === "approved").length,
      rejected: reports.filter((report) => report.status === "rejected").length,
    }),
    [reports],
  );

  const filteredReports = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return reports.filter((report) => {
      if (tab !== "all" && report.status !== tab) return false;
      if (!query) return true;
      return [
        report.id,
        report.reporterName,
        report.listingTitle ?? "",
        report.listingOwnerName ?? "",
        report.listingOwnerUsername ?? "",
        report.reasonText ?? "",
        report.description ?? "",
        report.status,
        report.reviewerName ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [reports, searchQuery, tab]);

  const columns = useMemo<AdminColumn<ListingReportView>[]>(
    () => [
      {
        key: "post",
        header: "Target Post",
        sortValue: (report) => report.listingTitle ?? "",
        cell: (report) => (
          <PrimaryCell
            alt={report.listingTitle ?? "Listing"}
            title={report.listingTitle ?? "Untitled listing"}
            subtitle={
              report.listingOwnerName
                ? `Owner: ${report.listingOwnerName}`
                : undefined
            }
          />
        ),
      },
      {
        key: "reporter",
        header: "Reported By",
        sortValue: (report) => report.reporterName,
        cell: (report) => <span>{report.reporterName || "—"}</span>,
      },
      {
        key: "reason",
        header: "Reason",
        sortValue: (report) => report.reasonText ?? "",
        cell: (report) => <span>{report.reasonText || "—"}</span>,
      },
      {
        key: "detail",
        header: "Detail",
        cell: (report) => (
          <span
            className="line-clamp-2 max-w-[280px] whitespace-normal text-muted-foreground"
            title={report.description ?? undefined}
          >
            {report.description || "—"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortValue: (report) => report.status,
        cell: (report) => (
          <ReportStatusBadge
            status={report.status}
            reviewerName={report.reviewerName}
          />
        ),
      },
      {
        key: "created",
        header: "Created",
        sortValue: (report) => report.createdAt,
        cell: (report) => <DateCell value={report.createdAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (report) => (
          <RowActions
            id={report.id}
            actions={[
              {
                label: "View post",
                icon: <Eye className="mr-2 size-4" />,
                onSelect: () => router.push(`/${locale}/${postHref(report)}`),
              },
              {
                label: "Approve",
                icon: <ThumbsUp className="mr-2 size-4" />,
                tone: "success",
                disabled: report.status === "approved",
                onSelect: () => void updateStatus(report.id, "approved"),
              },
              {
                label: "Reject",
                icon: <ThumbsDown className="mr-2 size-4" />,
                tone: "danger",
                disabled: report.status === "rejected",
                onSelect: () => void updateStatus(report.id, "rejected"),
              },
            ]}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateStatus only calls stable setters + the action
    [locale, router],
  );

  return (
    <AdminPage
      title="Report Posts"
      description="Manage and review posts reports"
      toolbar={
        <AdminSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search post, reporter, owner, reason..."
        />
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-sm">
          <TabsTrigger value="all" className="cursor-pointer rounded-sm">
            All Reports
          </TabsTrigger>
          <TabsTrigger value="pending" className="cursor-pointer rounded-sm">
            Pending
            <Badge className="ml-1 bg-blue-500 text-white">
              {counts.pending}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="approved" className="cursor-pointer rounded-sm">
            Approved
            <Badge className="ml-1 bg-green-500 text-white">
              {counts.approved}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="rejected" className="cursor-pointer rounded-sm">
            Rejected
            <Badge className="ml-1 bg-red-500 text-white">
              {counts.rejected}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AdminTable
        columns={columns}
        rows={filteredReports}
        rowKey={(report) => report.id}
        isLoading={isLoading}
        pageSize={20}
        resetKey={`${searchQuery}:${tab}`}
        emptyTitle="No reports found"
        emptyHint={searchQuery ? `No results for "${searchQuery}"` : undefined}
      />
    </AdminPage>
  );
}
