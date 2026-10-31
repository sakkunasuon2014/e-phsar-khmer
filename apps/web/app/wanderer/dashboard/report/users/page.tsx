"use client";

import { useMemo, useState } from "react";
import { Eye, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUserReports,
  updateUserReportStatus,
  type UserReportView,
} from "@/actions/admin-reports";
import { toast } from "@/components/ui/sonner";
import DbImage from "@/components/common/DbImage";
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

function EvidenceThumbs({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {urls.slice(0, 3).map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open evidence image"
          className="block size-7 overflow-hidden rounded border border-border"
        >
          <DbImage
            src={url}
            alt={`Evidence ${index + 1}`}
            width={28}
            height={28}
            className="size-7 object-cover"
            fallback={
              <span className="type-meta text-muted-foreground">—</span>
            }
          />
        </a>
      ))}
      {urls.length > 3 ? (
        <span
          className="type-meta text-muted-foreground"
          title={`${urls.length} images`}
        >
          +{urls.length - 3}
        </span>
      ) : null}
    </div>
  );
}

export default function ReportUsersPage() {
  const queryClient = useQueryClient();
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["admin", "reports", "users"],
    queryFn: getUserReports,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "reports", "users"] });

  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState("all");
  const router = useRouter();
  const locale = useLocale();

  const updateStatus = async (id: string, status: "approved" | "rejected") => {
    if (
      status === "approved" &&
      !window.confirm("Approving suspends this account. Continue?")
    )
      return;
    const res = await updateUserReportStatus(id, status);
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
        report.targetName,
        report.targetUsername ?? "",
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

  const columns = useMemo<AdminColumn<UserReportView>[]>(
    () => [
      {
        key: "target",
        header: "Target User",
        sortValue: (report) => report.targetName,
        cell: (report) => (
          <PrimaryCell
            shape="round"
            alt={report.targetName}
            title={report.targetName}
            subtitle={
              report.targetUsername
                ? `@${report.targetUsername}`
                : "No username"
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
          <div className="flex flex-col gap-1">
            <span
              className="line-clamp-2 max-w-[280px] whitespace-normal text-muted-foreground"
              title={report.description ?? undefined}
            >
              {report.description || "—"}
            </span>
            <EvidenceThumbs urls={report.imageUrls ?? []} />
          </div>
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
                label: "View profile",
                icon: <Eye className="mr-2 size-4" />,
                disabled: !report.targetUsername,
                onSelect: () => {
                  if (!report.targetUsername) return;
                  router.push(`/${locale}/${report.targetUsername}`);
                },
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
      title="Report Users"
      description="Manage and review user reports"
      toolbar={
        <AdminSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search reporter, target, reason, description..."
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
