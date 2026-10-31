"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { Eye, RotateCcw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import DbImage from "@/components/common/DbImage";
import {
  getAdminListings,
  removeListing,
  restoreListing,
  type AdminListingRow,
  type AdminListingsQuery,
} from "@/actions/admin-listings";
import { getAdminCategories } from "@/actions/admin-categories";
import { getAdminSubcategories } from "@/actions/admin-subcategories";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminFilter,
  AdminSearch,
  AdminTable,
  DateCell,
  RowActions,
  formatCount,
  type AdminColumn,
} from "@/components/dashboard/admin-table";

const PAGE_SIZE = 20;

/** Tabs → backend filters. "removed" = taken down by staff. */
const TABS: Record<
  string,
  Omit<
    AdminListingsQuery,
    "page" | "q" | "categorySlug" | "subcategorySlug" | "pageSize"
  >
> = {
  all: {},
  active: { status: "active", moderated: false },
  restricted: { status: "restricted" },
  removed: { moderated: true },
};

/** Soft status tones, matching the other admin tables (not solid fills).
 *  Solid tints on purpose: Tailwind's alpha colours (e.g. orange-500/10) render
 *  teal fringing at the rounded corners in Chrome on scaled displays. */
const STATUS_TONE: Record<string, string> = {
  active: "border-emerald-500 bg-emerald-50 text-emerald-700",
  draft: "border-slate-400 bg-slate-100 text-slate-600",
  expired: "border-amber-500 bg-amber-50 text-amber-700",
  restricted: "border-orange-500 bg-orange-50 text-orange-700",
  deleted: "border-red-500 bg-red-50 text-red-700",
  removed: "border-red-500 bg-red-50 text-red-700",
};

const priceLabel = (row: AdminListingRow) =>
  row.price === null
    ? "Negotiable"
    : `${row.currency === "USD" ? "$" : ""}${Number(row.price).toLocaleString()}`;

export default function AdminListingsPage() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [categorySlug, setCategorySlug] = useState("all");
  const [subcategorySlug, setSubcategorySlug] = useState("all");
  const [removing, setRemoving] = useState<AdminListingRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: getAdminCategories,
  });
  const { data: allSubcategories = [] } = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });

  const query: AdminListingsQuery = {
    ...TABS[tab],
    q: q || undefined,
    categorySlug: categorySlug === "all" ? undefined : categorySlug,
    subcategorySlug: subcategorySlug === "all" ? undefined : subcategorySlug,
    page,
    pageSize: PAGE_SIZE,
  };
  // Listings can run to thousands, so this page pages on the server rather
  // than filtering the full set client-side like the smaller admin tables.
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "listings", query],
    queryFn: () => getAdminListings(query),
    placeholderData: (prev) => prev,
  });
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  // Tab counts: one pageSize=1 call per preset under the CURRENT search and
  // category filters, so the numbers agree with what the tab will show.
  const activeCategory = categorySlug === "all" ? undefined : categorySlug;
  const activeSubcategory =
    subcategorySlug === "all" ? undefined : subcategorySlug;
  const { data: tabCounts = {} } = useQuery({
    queryKey: [
      "admin",
      "listings-counts",
      q ?? "",
      categorySlug,
      subcategorySlug,
    ],
    queryFn: async () => {
      // allSettled: one preset failing must not zero the other badges.
      const results = await Promise.allSettled(
        Object.keys(TABS).map(async (key) => {
          const page = await getAdminListings({
            ...TABS[key],
            q: q || undefined,
            categorySlug: activeCategory,
            subcategorySlug: activeSubcategory,
            page: 1,
            pageSize: 1,
          });
          return [key, page.total] as const;
        }),
      );
      const counts: Record<string, number> = {};
      for (const result of results) {
        if (result.status === "fulfilled") {
          const [key, total] = result.value;
          counts[key] = total;
        }
      }
      return counts;
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "listings"] });

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    const res = await removeListing(removing.id, reason);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Listing removed");
    setRemoving(null);
    setReason("");
    refresh();
  };

  const restore = async (row: AdminListingRow) => {
    const res = await restoreListing(row.id);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Listing restored");
    refresh();
  };

  const viewHref = (row: AdminListingRow) =>
    `/${locale}/${encodeURIComponent(
      row.title.replace(/\s+/g, "-").toLowerCase(),
    )}-adid-${row.id}`;

  const categoryBySlug = useMemo(
    () => new Map(categories.map((category) => [category.slug, category])),
    [categories],
  );
  const subcategoryBySlug = useMemo(
    () => new Map(allSubcategories.map((sub) => [sub.slug, sub])),
    [allSubcategories],
  );

  const selectedCategory = categories.find(
    (category) => category.slug === categorySlug,
  );
  const categoryOptions = categories.map((category) => ({
    value: category.slug,
    label: category.name,
  }));
  const subcategoryOptions = allSubcategories
    .filter(
      (sub) => !selectedCategory || sub.categoryId === selectedCategory.cateId,
    )
    .map((sub) => ({ value: sub.slug, label: sub.name }));

  const columns = useMemo<AdminColumn<AdminListingRow>[]>(
    () => [
      {
        key: "listing",
        header: "Listing",
        sortValue: (row) => row.title,
        cell: (row) => (
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-12 shrink-0 overflow-hidden rounded border border-border bg-muted">
              {row.coverPhotoUrl ? (
                <DbImage
                  src={row.coverPhotoUrl}
                  alt={row.title}
                  fill
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center type-meta text-muted-foreground">
                  —
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="max-w-[240px] truncate font-medium">
                {row.title}
              </div>
              {row.moderatedAt ? (
                <div className="max-w-[240px] truncate type-meta text-red-500">
                  Removed
                  {row.moderationReason ? `: ${row.moderationReason}` : ""}
                </div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: "seller",
        header: "Seller",
        sortValue: (row) => row.sellerUsername ?? "",
        cell: (row) =>
          row.sellerUsername ? (
            <span>@{row.sellerUsername}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "category",
        header: "Category",
        sortValue: (row) =>
          [
            categoryBySlug.get(row.categorySlug ?? "")?.name ?? "",
            subcategoryBySlug.get(row.subcategorySlug ?? "")?.name ?? "",
          ].join(" "),
        cell: (row) => {
          const category =
            categoryBySlug.get(row.categorySlug ?? "")?.name ??
            row.categorySlug ??
            "—";
          const subcategory =
            subcategoryBySlug.get(row.subcategorySlug ?? "")?.name ??
            row.subcategorySlug;
          return (
            <span className="block max-w-[220px] truncate text-muted-foreground">
              {subcategory ? `${category} / ${subcategory}` : category}
            </span>
          );
        },
      },
      {
        key: "price",
        header: "Price",
        sortValue: (row) => (row.price === null ? -1 : Number(row.price)),
        cell: (row) => <span>{priceLabel(row)}</span>,
      },
      {
        key: "status",
        header: "Status",
        sortValue: (row) => (row.moderatedAt ? "removed" : row.status),
        cell: (row) => {
          const status = row.moderatedAt ? "removed" : row.status;
          return (
            <Badge
              className={
                STATUS_TONE[status] ??
                "border-slate-400 bg-slate-100 text-slate-600"
              }
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          );
        },
      },
      {
        key: "reports",
        header: "Reports",
        align: "center",
        sortValue: (row) => row.pendingReports,
        cell: (row) =>
          row.pendingReports > 0 ? (
            <Badge className="border-red-500 bg-red-50 text-red-700">
              {row.pendingReports}
            </Badge>
          ) : (
            <span className="text-muted-foreground">0</span>
          ),
      },
      {
        key: "created",
        header: "Created",
        sortValue: (row) => row.createdAt,
        cell: (row) => <DateCell value={row.createdAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (row) => (
          <RowActions
            id={row.id}
            actions={
              row.moderatedAt
                ? [
                    {
                      label: "Restore",
                      icon: <RotateCcw className="mr-2 size-4" />,
                      tone: "success",
                      onSelect: () => void restore(row),
                    },
                  ]
                : [
                    {
                      label: "View listing",
                      icon: <Eye className="mr-2 size-4" />,
                      onSelect: () =>
                        window.open(
                          viewHref(row),
                          "_blank",
                          "noopener,noreferrer",
                        ),
                    },
                    {
                      label: "Remove",
                      icon: <ShieldOff className="mr-2 size-4" />,
                      tone: "danger",
                      onSelect: () => setRemoving(row),
                    },
                  ]
            }
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore/viewHref only read props/state
    [categoryBySlug, subcategoryBySlug, locale],
  );

  return (
    <>
      <AdminPage
        title="Listings"
        description="Review every ad and take down the ones that break the rules"
        toolbar={
          <>
            <form
              className="w-full max-w-sm"
              onSubmit={(event) => {
                event.preventDefault();
                setQ(searchInput.trim());
                setPage(1);
              }}
            >
              <AdminSearch
                value={searchInput}
                onChange={setSearchInput}
                placeholder="Search titles… (Enter)"
              />
            </form>
            <AdminFilter
              value={categorySlug}
              onChange={(value) => {
                setCategorySlug(value);
                setSubcategorySlug("all");
                setPage(1);
              }}
              allLabel="All Categories"
              options={categoryOptions}
            />
            <AdminFilter
              value={subcategorySlug}
              onChange={(value) => {
                setSubcategorySlug(value);
                setPage(1);
              }}
              allLabel="All Sub Categories"
              options={subcategoryOptions}
            />
          </>
        }
      >
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setPage(1);
          }}
        >
          <TabsList className="h-auto flex-wrap rounded-sm">
            {[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "restricted", label: "Over plan limit" },
              { value: "removed", label: "Removed" },
            ].map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="cursor-pointer rounded-sm"
              >
                {item.label}
                <Badge className="ml-1.5 px-1.5 py-0.5 type-meta">
                  {formatCount(tabCounts[item.value])}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <AdminTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyTitle={isLoading ? "Loading…" : "No listings found"}
          emptyHint={q ? `No results for "${q}"` : undefined}
          serverPagination={{
            page,
            totalPages,
            total: data?.total ?? 0,
            onPageChange: setPage,
            totalLabel: "listings",
          }}
        />
      </AdminPage>

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove listing</DialogTitle>
            <DialogDescription>
              &quot;{removing?.title}&quot; will be hidden everywhere and the
              seller won&apos;t be able to republish it. You can restore it
              later.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional, visible to staff)"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 rounded-sm cursor-pointer"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              className="h-9 rounded-sm bg-red-500 text-white hover:bg-red-600 cursor-pointer"
              onClick={confirmRemove}
            >
              {busy ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
