"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import {
  getUserSubscriptions,
  grantSubscription,
  revokeUserSubscription,
  type UserSubscriptionRow,
} from "@/actions/admin-user-subscriptions";
import type { SupersededReason } from "@/types/subscription";
import { getAdminUsers } from "@/actions/admin-users";
import {
  getSubCategories,
  getSubPackages,
  getSubTerms,
} from "@/actions/admin-subscriptions";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminSearch,
  AdminTable,
  DateCell,
  EntityChip,
  PrimaryCell,
  RowActions,
  formatCount,
  type AdminColumn,
} from "@/components/dashboard/admin-table";

type Subscription = {
  id: string;
  accountId: string;
  name: string;
  email: string;
  phone: string;
  /** Subscription-category id — the tab key (names are free text like "Auto 8137"). */
  categoryId: string | null;
  group: string;
  totalAds: number;
  totalRenew: number;
  autoRenew: number;
  term: string;
  price: number;
  paymentMethod: string;
  subscribedAt: string;
  expiredAt: string;
  status: UserSubscriptionRow["status"];
  supersededReason: SupersededReason | null;
};

// A superseded row is history, not a second subscription: label it by why it
// was retired so it never reads as another active plan.
function statusBadge(sub: Subscription): { label: string; className: string } {
  const muted = "text-muted-foreground border-border bg-muted";
  const red = "text-red-700 border-red-500 bg-red-50";
  switch (sub.status) {
    case "active":
      return {
        label: "Active",
        className: "text-emerald-700 border-emerald-500 bg-emerald-50",
      };
    case "expired":
      return { label: "Expired", className: red };
    case "revoked":
      return { label: "Revoked", className: red };
    case "superseded":
      return {
        label: sub.supersededReason === "upgrade" ? "Upgraded" : "Replaced",
        className: muted,
      };
  }
}

export default function SubscriptionPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"current" | "history">("current");
  const {
    data: subscription = [],
    isError,
    error,
  } = useQuery({
    queryKey: ["admin", "user-subscriptions", view],
    queryFn: async (): Promise<Subscription[]> => {
      const rows = await getUserSubscriptions(view === "history");
      return rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        name: r.name,
        email: r.email ?? "",
        phone: r.phone ?? "",
        categoryId: r.subscriptionCategoryId ?? null,
        group: r.group ?? "—",
        totalAds: r.totalAds,
        totalRenew: r.totalRenew,
        autoRenew: r.autoRenew,
        term: r.term ?? "—",
        price: Number(r.price),
        paymentMethod: r.paymentMethod ?? "—",
        subscribedAt: r.subscribedAt.slice(0, 10),
        expiredAt: r.expiresAt,
        status: r.status,
        supersededReason: r.supersededReason,
      }));
    },
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["admin", "user-subscriptions"],
    });

  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState("all");

  // Grant dialog state + cascade
  const [isGrantOpen, setIsGrantOpen] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [grant, setGrant] = useState({
    userId: "",
    categoryId: "",
    packageId: "",
    termId: "",
    paymentMethod: "Bank",
  });
  const [granting, setGranting] = useState(false);

  const { data: userResults = { users: [] } } = useQuery({
    queryKey: ["admin", "users", "search", userQuery],
    queryFn: () => getAdminUsers({ q: userQuery, pageSize: 8 }),
    enabled: isGrantOpen,
  });
  // Always loaded: the category tabs are built from the real subscription
  // categories, so adding a sixth group needs no code change. Same key the
  // grant dialog uses, so the dialog and the tabs share one fetch.
  const { data: grantCategories = [] } = useQuery({
    queryKey: ["admin", "sub", "categories"],
    queryFn: () => getSubCategories(),
  });
  const { data: grantPackages = [] } = useQuery({
    queryKey: ["admin", "sub", "packages", grant.categoryId],
    queryFn: () => getSubPackages(grant.categoryId),
    enabled: isGrantOpen && !!grant.categoryId,
  });
  const { data: grantTerms = [] } = useQuery({
    queryKey: ["admin", "sub", "terms", grant.packageId],
    queryFn: () => getSubTerms(grant.packageId),
    enabled: isGrantOpen && !!grant.packageId,
  });

  const handleGrant = async () => {
    if (!grant.userId || !grant.termId) return;
    setGranting(true);
    const res = await grantSubscription({
      userId: grant.userId,
      termId: grant.termId,
      paymentMethod: grant.paymentMethod,
    });
    setGranting(false);
    if (res.success) {
      refresh();
      setIsGrantOpen(false);
      setGrant({
        userId: "",
        categoryId: "",
        packageId: "",
        termId: "",
        paymentMethod: "Bank",
      });
      toast.success("Subscription granted");
    } else {
      toast.error(res.error);
    }
  };

  const filteredSubscriptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return subscription.filter((sub) => {
      if (tab !== "all" && sub.categoryId !== tab) return false;
      if (!q) return true;
      return [
        sub.id,
        sub.accountId,
        sub.name,
        sub.email,
        sub.phone,
        sub.group,
        sub.term,
        sub.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [subscription, searchQuery, tab]);
  const [revokeTarget, setRevokeTarget] = useState<Subscription | null>(null);
  const [revoking, setRevoking] = useState(false);
  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    const res = await revokeUserSubscription(revokeTarget.id);
    setRevoking(false);
    if (res.success) {
      refresh();
      setRevokeTarget(null);
      toast.success("Subscription revoked");
    } else {
      toast.error(res.error);
    }
  };

  const columns = useMemo<AdminColumn<Subscription>[]>(
    () => [
      {
        key: "subscriber",
        header: "Subscriber",
        sortValue: (sub) => sub.name,
        cell: (sub) => (
          <PrimaryCell
            shape="round"
            alt={sub.name}
            title={sub.name}
            subtitle={sub.email || "No email"}
          />
        ),
      },
      {
        key: "phone",
        header: "Phone",
        sortValue: (sub) => sub.phone,
        cell: (sub) =>
          sub.phone ? (
            <span>{sub.phone}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "term",
        header: "Term",
        sortValue: (sub) => sub.term,
        cell: (sub) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{sub.term}</span>
            <span className="type-meta text-muted-foreground">
              ${sub.price} · {sub.paymentMethod}
            </span>
          </div>
        ),
      },
      {
        key: "group",
        header: "Category",
        sortValue: (sub) => sub.group,
        cell: (sub) => <EntityChip tone="category">{sub.group}</EntityChip>,
      },
      {
        key: "usage",
        header: "Usage",
        sortValue: (sub) => sub.totalAds,
        cell: (sub) => (
          <div className="flex flex-col gap-0.5 type-meta">
            <span>
              {sub.totalAds} ads · {sub.totalRenew} renews
            </span>
            <span className="text-muted-foreground">
              Auto renew {sub.autoRenew}
            </span>
          </div>
        ),
      },
      {
        key: "period",
        header: "Period",
        sortValue: (sub) => sub.expiredAt,
        cell: (sub) => (
          <div className="flex items-center gap-1.5 type-meta text-muted-foreground">
            <DateCell value={sub.subscribedAt} />
            <span>→</span>
            <DateCell value={sub.expiredAt} />
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortValue: (sub) => sub.status,
        cell: (sub) => {
          const badge = statusBadge(sub);
          return <Badge className={badge.className}>{badge.label}</Badge>;
        },
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (sub) => (
          <RowActions
            id={sub.id}
            actions={
              sub.status === "active"
                ? [
                    {
                      label: "Revoke",
                      tone: "danger",
                      onSelect: () => setRevokeTarget(sub),
                    },
                  ]
                : []
            }
          />
        ),
      },
    ],
    [],
  );

  return (
    <>
      <AdminPage
        title="Users Subscription"
        description="Manage subscription plans and users"
        action={
          <Button
            onClick={() => setIsGrantOpen(true)}
            className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
          >
            <Plus className="mr-2 size-4" />
            Grant Subscription
          </Button>
        }
        toolbar={
          <>
            <AdminSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search name, email, phone, category, term..."
            />
            <Select
              value={view}
              onValueChange={(value) => setView(value as "current" | "history")}
            >
              <SelectTrigger className="h-9 w-full rounded-sm border-border bg-card text-foreground sm:w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current subscriptions</SelectItem>
                <SelectItem value="history">Full history</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      >
        {isError ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="font-medium">Couldn&apos;t load subscriptions</p>
            <p className="mt-1 type-body-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Reload the page to try again."}
            </p>
          </div>
        ) : (
          <>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-auto flex-wrap gap-1">
                <TabsTrigger value="all" className="cursor-pointer">
                  All Subscription
                </TabsTrigger>
                {grantCategories.map((category) => (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="cursor-pointer"
                  >
                    {category.name}
                    <Badge className="ml-1.5 px-1.5 py-0.5 type-meta">
                      {formatCount(
                        subscription.filter(
                          (sub) => sub.categoryId === category.id,
                        ).length,
                      )}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <AdminTable
              columns={columns}
              rows={filteredSubscriptions}
              rowKey={(sub) => sub.id}
              pageSize={20}
              resetKey={`${searchQuery}:${tab}:${view}`}
              emptyTitle="No subscriptions found"
              emptyHint={
                searchQuery
                  ? `No results for "${searchQuery}"`
                  : view === "current"
                    ? "No current subscriptions — switch to Full history to see revoked, superseded and expired ones."
                    : undefined
              }
            />
          </>
        )}
      </AdminPage>

      {/* Grant Subscription dialog */}
      <Dialog open={isGrantOpen} onOpenChange={setIsGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant Subscription</DialogTitle>
            <DialogDescription>
              Assign a subscription term to a user.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>User</Label>
              <Input
                placeholder="Search by name, phone or email..."
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
              />
              <Select
                value={grant.userId}
                onValueChange={(v) => setGrant({ ...grant, userId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {userResults.users.map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {u.name} —{" "}
                      {u.networks[0] ?? u.email ?? u.userId.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                value={grant.categoryId}
                onValueChange={(v) =>
                  setGrant({
                    ...grant,
                    categoryId: v,
                    packageId: "",
                    termId: "",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {grantCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Tier</Label>
              <Select
                value={grant.packageId}
                onValueChange={(v) =>
                  setGrant({ ...grant, packageId: v, termId: "" })
                }
                disabled={!grant.categoryId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a tier" />
                </SelectTrigger>
                <SelectContent>
                  {grantPackages
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Term</Label>
              <Select
                value={grant.termId}
                onValueChange={(v) => setGrant({ ...grant, termId: v })}
                disabled={!grant.packageId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a term" />
                </SelectTrigger>
                <SelectContent>
                  {grantTerms
                    .filter((t) => t.isActive)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} — ${t.price}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select
                value={grant.paymentMethod}
                onValueChange={(v) => setGrant({ ...grant, paymentMethod: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bank">Bank</SelectItem>
                  <SelectItem value="Credit Card">Credit Card</SelectItem>
                  <SelectItem value="Debit Card">Debit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 rounded-sm cursor-pointer"
              onClick={() => setIsGrantOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
              onClick={handleGrant}
              disabled={granting || !grant.userId || !grant.termId}
            >
              Grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke subscription?</DialogTitle>
            <DialogDescription>
              {revokeTarget?.name}&apos;s {revokeTarget?.term} subscription ends
              now. The record stays in the history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 rounded-sm cursor-pointer"
              onClick={() => setRevokeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              className="h-9 rounded-sm bg-red-500 text-white hover:bg-red-600 hover:text-white cursor-pointer"
              disabled={revoking}
              onClick={handleRevoke}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
