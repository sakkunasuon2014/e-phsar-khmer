"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminFilter,
  AdminSearch,
  AdminTable,
  DateCell,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";
import { SubscriptionScopeDialog } from "@/components/dashboard/subscription-scope-dialog";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  createSubCategory,
  deleteSubCategory,
  getSubCategories,
  getSubPackages,
  updateSubCategory,
  type SubCategory,
  type SubPackage,
} from "@/actions/admin-subscriptions";
import { TIER_LABEL, type Tier } from "@/lib/subscription-admin";

type Row = SubCategory & { tierNames: string[] };

type GroupForm = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

function emptyGroup(): GroupForm {
  return {
    name: "",
    slug: "",
    description: "",
    sortOrder: "0",
    isActive: true,
  };
}

function toGroupForm(group: SubCategory): GroupForm {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    description: group.description ?? "",
    sortOrder: String(group.sortOrder),
    isActive: group.isActive,
  };
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<GroupForm | null>(null);
  const [scopeGroup, setScopeGroup] = useState<SubCategory | null>(null);
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
    queryClient.invalidateQueries({ queryKey: ["admin", "sub", "categories"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "sub", "packages"] });
    // Deleting a group cascades its tiers' terms; keep the Terms page honest.
    queryClient.invalidateQueries({ queryKey: ["admin", "sub", "terms"] });
  };

  const tiersByGroup = useMemo(() => {
    const map = new Map<string, SubPackage[]>();
    for (const pkg of packages.data ?? []) {
      const list = map.get(pkg.categoryId) ?? [];
      list.push(pkg);
      map.set(pkg.categoryId, list);
    }
    return map;
  }, [packages.data]);

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return (categories.data ?? [])
      .map((group) => ({
        ...group,
        tierNames: (tiersByGroup.get(group.id) ?? []).map(
          (pkg) => TIER_LABEL[pkg.tier as Tier],
        ),
      }))
      .filter((group) => {
        if (status === "active" && !group.isActive) return false;
        if (status === "inactive" && group.isActive) return false;
        if (!q) return true;
        return [group.name, group.slug, group.description ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [categories.data, tiersByGroup, search, status]);

  async function saveGroup(groupForm: GroupForm) {
    const body = {
      name: groupForm.name.trim(),
      slug: groupForm.slug.trim(),
      description: groupForm.description.trim(),
      sortOrder: Number(groupForm.sortOrder) || 0,
      isActive: groupForm.isActive,
    };
    setSaving(true);
    const res = groupForm.id
      ? await updateSubCategory(groupForm.id, body)
      : await createSubCategory(body);
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(
      groupForm.id ? "Subscription updated" : "Subscription created",
    );
    setForm(null);
    refresh();
  }

  async function removeGroup(group: SubCategory) {
    if (
      !window.confirm(
        `Delete ${group.name}? Its tiers and terms are removed, current subscribers drop to the free plan, and their history keeps the snapshot they bought.`,
      )
    ) {
      return;
    }
    const res = await deleteSubCategory(group.id);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Subscription deleted");
    refresh();
  }

  const columns: AdminColumn<Row>[] = [
    {
      key: "name",
      header: "Subscription",
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <div className="font-medium leading-tight">{row.name}</div>
          <div className="type-meta text-muted-foreground">{row.slug}</div>
        </div>
      ),
    },
    {
      key: "description",
      header: "Description",
      sortValue: (row) => row.description ?? "",
      className: "max-w-[360px]",
      cell: (row) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">
          {row.description || "—"}
        </span>
      ),
    },
    {
      key: "coverage",
      header: "Coverage",
      align: "right",
      sortValue: (row) => row.subcategoryIds?.length ?? 0,
      cell: (row) => {
        const count = row.subcategoryIds?.length ?? 0;
        return (
          <span className="tabular-nums">
            {count === 0 ? (
              <span className="text-orange-600">None</span>
            ) : (
              `${count} subcategories`
            )}
          </span>
        );
      },
    },
    {
      key: "tiers",
      header: "Tiers",
      sortValue: (row) => row.tierNames.length,
      cell: (row) =>
        row.tierNames.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.tierNames.map((name) => (
              <Badge key={name} className="bg-[#00a0e9]/10 text-[#00a0e9]">
                {name}
              </Badge>
            ))}
          </div>
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
      key: "updated",
      header: "Updated",
      sortValue: (row) => row.updatedAt,
      cell: (row) => <DateCell value={row.updatedAt} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <RowActions
          id={row.id}
          actions={[
            { label: "Edit", onSelect: () => setForm(toGroupForm(row)) },
            {
              label: "Edit coverage",
              onSelect: () => setScopeGroup(row),
            },
            {
              label: "Delete",
              tone: "danger",
              onSelect: () => void removeGroup(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <AdminPage
      title="Subscriptions"
      description="The premium groups (Auto, Property, …) and the listing subcategories they cover. Each group sells tiers and terms on its own page."
      action={
        <Button
          className="h-9 rounded-sm bg-[#00a0e9] text-white hover:bg-[#008ccb]"
          onClick={() => setForm(emptyGroup())}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New subscription
        </Button>
      }
      toolbar={
        <>
          <AdminSearch
            value={search}
            onChange={setSearch}
            placeholder="Search name, slug or description..."
          />
          <AdminFilter
            value={status}
            onChange={setStatus}
            allLabel="All statuses"
            options={STATUS_OPTIONS}
          />
        </>
      }
    >
      <AdminTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={categories.isLoading || packages.isLoading}
        emptyTitle={
          categories.isError
            ? "Couldn't load subscriptions"
            : "No subscriptions yet"
        }
        emptyHint={
          categories.isError
            ? "Refresh the page to try again."
            : "Create one, then give it a coverage scope and its tiers."
        }
        pageSize={20}
        resetKey={`${search}|${status}`}
        initialSort={{ key: "name", dir: "asc" }}
      />

      {scopeGroup && (
        <SubscriptionScopeDialog
          group={scopeGroup}
          groups={categories.data ?? []}
          onClose={() => setScopeGroup(null)}
          onSaved={refresh}
        />
      )}

      <Dialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Edit subscription" : "New subscription"}
            </DialogTitle>
            <DialogDescription>
              A subscription groups the listing subcategories whose ads share
              its tiers. Set the coverage after saving.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="group-name">Name</Label>
                <Input
                  id="group-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Auto"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="group-slug">Slug</Label>
                <Input
                  id="group-slug"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="auto"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="group-desc">Description</Label>
                <Textarea
                  id="group-desc"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="What this subscription covers…"
                />
              </div>
              <div className="flex items-end justify-between gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="group-order">Sort order</Label>
                  <Input
                    id="group-order"
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm({ ...form, sortOrder: e.target.value })
                    }
                    className="w-24"
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
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
            </div>
          )}
          <DialogFooter>
            <Button
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600"
              disabled={saving}
              onClick={() => form && void saveGroup(form)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
