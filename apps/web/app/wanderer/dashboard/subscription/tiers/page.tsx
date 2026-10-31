"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminFilter,
  AdminSearch,
  AdminTable,
  EntityChip,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import {
  createSubPackage,
  deleteSubPackage,
  getSubCategories,
  getSubPackages,
  updateSubPackage,
  type SubPackage,
} from "@/actions/admin-subscriptions";
import { TIERS, TIER_LABEL, type Tier } from "@/lib/subscription-admin";

type Row = SubPackage & { groupName: string };

type TierForm = {
  id?: string;
  categoryId: string;
  tier: Tier;
  photos: string;
  ads: string;
  renews: string;
  autoRenews: string;
  videos: string;
  isActive: boolean;
};

function emptyTier(categoryId: string): TierForm {
  return {
    categoryId,
    tier: "bronze",
    photos: "0",
    ads: "0",
    renews: "0",
    autoRenews: "0",
    videos: "0",
    isActive: true,
  };
}

function toTierForm(pkg: SubPackage): TierForm {
  return {
    id: pkg.id,
    categoryId: pkg.categoryId,
    tier: pkg.tier,
    photos: String(pkg.photos),
    ads: String(pkg.ads),
    renews: String(pkg.renews),
    autoRenews: String(pkg.autoRenews),
    videos: String(pkg.videos),
    isActive: pkg.isActive,
  };
}

export default function TiersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [form, setForm] = useState<TierForm | null>(null);
  const [saving, setSaving] = useState(false);

  const categories = useQuery({
    queryKey: ["admin", "sub", "categories"],
    queryFn: getSubCategories,
  });
  const packages = useQuery({
    queryKey: ["admin", "sub", "packages"],
    queryFn: () => getSubPackages(),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "sub", "packages"] });
    // Deleting a tier cascades its terms.
    queryClient.invalidateQueries({ queryKey: ["admin", "sub", "terms"] });
  };

  const groupName = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of categories.data ?? []) map.set(group.id, group.name);
    return map;
  }, [categories.data]);

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return (packages.data ?? [])
      .map((pkg) => ({
        ...pkg,
        groupName: groupName.get(pkg.categoryId) ?? "—",
      }))
      .filter((pkg) => {
        if (groupFilter !== "all" && pkg.categoryId !== groupFilter)
          return false;
        if (tierFilter !== "all" && pkg.tier !== tierFilter) return false;
        if (!q) return true;
        return `${pkg.groupName} ${TIER_LABEL[pkg.tier]}`
          .toLowerCase()
          .includes(q);
      })
      .sort(
        (a, b) =>
          a.groupName.localeCompare(b.groupName) || a.sortOrder - b.sortOrder,
      );
  }, [packages.data, groupName, search, groupFilter, tierFilter]);

  async function saveTier(tierForm: TierForm) {
    const body = {
      tier: tierForm.tier,
      photos: Number(tierForm.photos) || 0,
      ads: Number(tierForm.ads) || 0,
      renews: Number(tierForm.renews) || 0,
      autoRenews: Number(tierForm.autoRenews) || 0,
      videos: Number(tierForm.videos) || 0,
      isActive: tierForm.isActive,
    };
    setSaving(true);
    const res = tierForm.id
      ? await updateSubPackage(tierForm.id, body)
      : await createSubPackage({ ...body, categoryId: tierForm.categoryId });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(tierForm.id ? "Tier updated" : "Tier created");
    setForm(null);
    refresh();
  }

  async function removeTier(pkg: Row) {
    if (
      !window.confirm(
        `Delete the ${pkg.groupName} ${TIER_LABEL[pkg.tier]} tier and all of its terms?`,
      )
    ) {
      return;
    }
    const res = await deleteSubPackage(pkg.id);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Tier deleted");
    refresh();
  }

  const columns: AdminColumn<Row>[] = [
    {
      key: "tier",
      header: "Tier",
      sortValue: (row) => TIER_LABEL[row.tier],
      cell: (row) => (
        <Badge className="bg-[#00a0e9]/10 text-[#00a0e9]">
          {TIER_LABEL[row.tier]}
        </Badge>
      ),
    },
    {
      key: "group",
      header: "Subscription",
      sortValue: (row) => row.groupName,
      cell: (row) => <EntityChip tone="category">{row.groupName}</EntityChip>,
    },
    {
      key: "ads",
      header: "Ads",
      align: "right",
      sortValue: (row) => row.ads,
      cell: (row) => <span className="tabular-nums">{row.ads}</span>,
    },
    {
      key: "photos",
      header: "Photos",
      align: "right",
      sortValue: (row) => row.photos,
      cell: (row) => <span className="tabular-nums">{row.photos}</span>,
    },
    {
      key: "renews",
      header: "Renews",
      align: "right",
      sortValue: (row) => row.renews,
      cell: (row) => <span className="tabular-nums">{row.renews}</span>,
    },
    {
      key: "extras",
      header: "Extras",
      sortValue: (row) => row.autoRenews + row.videos,
      cell: (row) => (
        <span className="type-meta text-muted-foreground">
          Auto-renews {row.autoRenews} · Videos {row.videos}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => (row.isActive ? 1 : 0),
      cell: (row) =>
        row.isActive ? (
          <Badge className="border-emerald-500 bg-emerald-50 text-emerald-700">
            Active
          </Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <RowActions
          id={row.id}
          actions={[
            { label: "Edit", onSelect: () => setForm(toTierForm(row)) },
            {
              label: "Delete",
              tone: "danger",
              onSelect: () => void removeTier(row),
            },
          ]}
        />
      ),
    },
  ];

  const groupOptions = (categories.data ?? []).map((group) => ({
    value: group.id,
    label: group.name,
  }));
  const tierOptions = TIERS.map((tier) => ({
    value: tier,
    label: TIER_LABEL[tier],
  }));

  return (
    <AdminPage
      title="Tiers"
      description="The Bronze, Silver and Gold packages a subscription sells. Limits apply per subscription, so Auto Bronze (30 ads) differs from General Bronze (200)."
      action={
        <Button
          className="h-9 rounded-sm bg-[#00a0e9] text-white hover:bg-[#008ccb]"
          onClick={() => setForm(emptyTier(categories.data?.[0]?.id ?? ""))}
          disabled={(categories.data ?? []).length === 0}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New tier
        </Button>
      }
      toolbar={
        <>
          <AdminSearch
            value={search}
            onChange={setSearch}
            placeholder="Search subscription or tier..."
          />
          <AdminFilter
            value={groupFilter}
            onChange={setGroupFilter}
            allLabel="All subscriptions"
            options={groupOptions}
          />
          <AdminFilter
            value={tierFilter}
            onChange={setTierFilter}
            allLabel="All tiers"
            options={tierOptions}
          />
        </>
      }
    >
      <AdminTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={categories.isLoading || packages.isLoading}
        emptyTitle={packages.isError ? "Couldn't load tiers" : "No tiers yet"}
        emptyHint={
          packages.isError
            ? "Refresh the page to try again."
            : "Add Bronze, Silver or Gold to a subscription."
        }
        pageSize={20}
        resetKey={`${search}|${groupFilter}|${tierFilter}`}
        initialSort={{ key: "group", dir: "asc" }}
      />

      <Dialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit tier" : "New tier"}</DialogTitle>
            <DialogDescription>
              One row per subscription and tier. The limits live here; each
              tier&apos;s prices and durations are managed under Terms.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Subscription</Label>
                {form.id ? (
                  <p className="rounded-sm border bg-muted/40 px-3 py-2 text-sm">
                    {groupName.get(form.categoryId) ?? "—"}
                  </p>
                ) : (
                  <Select
                    value={form.categoryId}
                    onValueChange={(value) =>
                      setForm({ ...form, categoryId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a subscription" />
                    </SelectTrigger>
                    <SelectContent>
                      {(categories.data ?? []).map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label>Tier</Label>
                <Select
                  value={form.tier}
                  onValueChange={(value) =>
                    setForm({ ...form, tier: value as Tier })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIERS.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {TIER_LABEL[tier]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(
                  [
                    ["photos", "Photos"],
                    ["ads", "Ads"],
                    ["renews", "Renews"],
                    ["autoRenews", "Auto-renews"],
                    ["videos", "Videos"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="grid gap-1.5">
                    <Label htmlFor={`tier-${key}`}>{label}</Label>
                    <Input
                      id={`tier-${key}`}
                      type="number"
                      min={0}
                      value={form[key]}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  className="data-checked:bg-[#00a0e9]"
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, isActive: checked })
                  }
                />
                Active
              </label>
            </div>
          )}
          <DialogFooter>
            <Button
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600"
              disabled={saving || !form?.categoryId}
              onClick={() => form && void saveTier(form)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
