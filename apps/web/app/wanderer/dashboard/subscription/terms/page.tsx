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
  createSubTerm,
  deleteSubTerm,
  getSubCategories,
  getSubPackages,
  getSubTerms,
  updateSubTerm,
  type SubPackage,
  type SubTerm,
} from "@/actions/admin-subscriptions";
import {
  TERM_MONTHS,
  TIERS,
  TIER_LABEL,
  discountLabel,
  finalPrice,
  termLabel,
  type Tier,
} from "@/lib/subscription-admin";

type Row = SubTerm & { groupName: string };

type TermForm = {
  id?: string;
  categoryId: string;
  packageId: string;
  /** Null on a retired legacy duration (1 month); the picker is hidden. */
  durationMonths: 3 | 6 | 12 | null;
  legacyLabel: string | null;
  price: string;
  discount: string;
  discountType: "percent" | "amount";
  isActive: boolean;
};

function emptyTerm(categoryId: string): TermForm {
  return {
    categoryId,
    packageId: "",
    durationMonths: 3,
    legacyLabel: null,
    price: "0",
    discount: "0",
    discountType: "percent",
    isActive: true,
  };
}

export default function TermsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [form, setForm] = useState<TermForm | null>(null);
  const [saving, setSaving] = useState(false);

  const categories = useQuery({
    queryKey: ["admin", "sub", "categories"],
    queryFn: getSubCategories,
  });
  const packages = useQuery({
    queryKey: ["admin", "sub", "packages"],
    queryFn: () => getSubPackages(),
  });
  const terms = useQuery({
    queryKey: ["admin", "sub", "terms"],
    queryFn: () => getSubTerms(),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "sub", "terms"] });
  };

  const groupById = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of categories.data ?? []) map.set(group.id, group.name);
    return map;
  }, [categories.data]);
  const packageById = useMemo(() => {
    const map = new Map<string, SubPackage>();
    for (const pkg of packages.data ?? []) map.set(pkg.id, pkg);
    return map;
  }, [packages.data]);

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return (terms.data ?? [])
      .map((term) => {
        const pkg = packageById.get(term.packageId);
        return {
          ...term,
          groupName: pkg ? (groupById.get(pkg.categoryId) ?? "—") : "—",
        };
      })
      .filter((term) => {
        const pkg = packageById.get(term.packageId);
        if (groupFilter !== "all" && pkg?.categoryId !== groupFilter)
          return false;
        if (tierFilter !== "all" && pkg?.tier !== tierFilter) return false;
        if (!q) return true;
        const label = termLabel(term.durationValue);
        return `${term.groupName} ${pkg ? TIER_LABEL[pkg.tier] : ""} ${label}`
          .toLowerCase()
          .includes(q);
      })
      .sort(
        (a, b) =>
          a.groupName.localeCompare(b.groupName) ||
          (packageById.get(a.packageId)?.sortOrder ?? 0) -
            (packageById.get(b.packageId)?.sortOrder ?? 0) ||
          a.sortOrder - b.sortOrder,
      );
  }, [terms.data, packageById, groupById, search, groupFilter, tierFilter]);

  async function saveTerm(termForm: TermForm) {
    const body = {
      durationMonths: termForm.durationMonths ?? undefined,
      price: Number(termForm.price) || 0,
      discount: Number(termForm.discount) || 0,
      discountType: termForm.discountType,
      isActive: termForm.isActive,
    };
    setSaving(true);
    const res = termForm.id
      ? await updateSubTerm(termForm.id, body)
      : await createSubTerm({ ...body, packageId: termForm.packageId });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(termForm.id ? "Term updated" : "Term created");
    setForm(null);
    refresh();
  }

  async function removeTerm(term: Row) {
    if (!window.confirm(`Delete the ${termLabel(term.durationValue)} term?`)) {
      return;
    }
    const res = await deleteSubTerm(term.id);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Term deleted");
    refresh();
  }

  function editTerm(term: SubTerm) {
    const pkg = packageById.get(term.packageId);
    const conforming =
      term.durationUnit === "month" &&
      (TERM_MONTHS as readonly number[]).includes(term.durationValue);
    setForm({
      id: term.id,
      categoryId: pkg?.categoryId ?? "",
      packageId: term.packageId,
      durationMonths: conforming ? (term.durationValue as 3 | 6 | 12) : null,
      legacyLabel: conforming
        ? null
        : `${term.durationValue} ${term.durationUnit}`,
      price: term.price,
      discount: term.discount,
      discountType: term.discountType,
      isActive: term.isActive,
    });
  }

  const tierOf = (packageId: string): Tier | null =>
    packageById.get(packageId)?.tier ?? null;

  const columns: AdminColumn<Row>[] = [
    {
      key: "term",
      header: "Term",
      sortValue: (row) => row.durationValue,
      cell: (row) => (
        <div className="min-w-0">
          <div className="font-medium leading-tight">
            {termLabel(row.durationValue)}
          </div>
          {!(
            row.durationUnit === "month" &&
            (TERM_MONTHS as readonly number[]).includes(row.durationValue)
          ) && (
            <div className="type-meta text-orange-600">Retired duration</div>
          )}
        </div>
      ),
    },
    {
      key: "group",
      header: "Subscription",
      sortValue: (row) => row.groupName,
      cell: (row) => <EntityChip tone="category">{row.groupName}</EntityChip>,
    },
    {
      key: "tier",
      header: "Tier",
      sortValue: (row) => TIER_LABEL[tierOf(row.packageId) ?? "bronze"],
      cell: (row) => {
        const tier = tierOf(row.packageId);
        return tier ? (
          <Badge className="bg-[#00a0e9]/10 text-[#00a0e9]">
            {TIER_LABEL[tier]}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      sortValue: (row) => finalPrice(row.price, row.discount, row.discountType),
      cell: (row) => {
        const price = finalPrice(row.price, row.discount, row.discountType);
        const original = Number(row.price);
        return (
          <span className="tabular-nums">
            {price < original && (
              <span className="mr-2 text-xs text-muted-foreground line-through">
                ${original.toLocaleString("en-US")}
              </span>
            )}
            <span className="font-medium">
              ${price.toLocaleString("en-US")}
            </span>
          </span>
        );
      },
    },
    {
      key: "discount",
      header: "Discount",
      sortValue: (row) => Number(row.discount),
      cell: (row) => {
        const label = discountLabel(row.discount, row.discountType);
        return label ? (
          <Badge className="bg-red-100 text-red-500">{label}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
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
          <Badge variant="outline">Retired</Badge>
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
            { label: "Edit", onSelect: () => editTerm(row) },
            {
              label: "Delete",
              tone: "danger",
              onSelect: () => void removeTerm(row),
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
  const packagesForCategory = (categoryId: string) =>
    (packages.data ?? [])
      .filter((pkg) => pkg.categoryId === categoryId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <AdminPage
      title="Terms"
      description="The purchasable prices: one row per tier and fixed 3, 6 or 12-month duration. Prices are snapshotted onto the purchase at checkout."
      action={
        <Button
          className="h-9 rounded-sm bg-[#00a0e9] text-white hover:bg-[#008ccb]"
          onClick={() => setForm(emptyTerm(categories.data?.[0]?.id ?? ""))}
          disabled={(packages.data ?? []).length === 0}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New term
        </Button>
      }
      toolbar={
        <>
          <AdminSearch
            value={search}
            onChange={setSearch}
            placeholder="Search subscription, tier or term..."
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
        isLoading={
          categories.isLoading || packages.isLoading || terms.isLoading
        }
        emptyTitle={terms.isError ? "Couldn't load terms" : "No terms yet"}
        emptyHint={
          terms.isError
            ? "Refresh the page to try again."
            : "Add a price to a tier; only 3, 6 and 12 months can be sold."
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
            <DialogTitle>{form?.id ? "Edit term" : "New term"}</DialogTitle>
            <DialogDescription>
              One price per tier and duration. Retired durations can be edited
              but not reactivated.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Subscription</Label>
                  {form.id ? (
                    <p className="rounded-sm border bg-muted/40 px-3 py-2 text-sm">
                      {groupById.get(form.categoryId) ?? "—"}
                    </p>
                  ) : (
                    <Select
                      value={form.categoryId}
                      onValueChange={(value) =>
                        setForm({
                          ...form,
                          categoryId: value,
                          packageId: "",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
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
                  {form.id ? (
                    <p className="rounded-sm border bg-muted/40 px-3 py-2 text-sm">
                      {tierOf(form.packageId)
                        ? TIER_LABEL[tierOf(form.packageId) as Tier]
                        : "—"}
                    </p>
                  ) : (
                    <Select
                      value={form.packageId}
                      onValueChange={(value) =>
                        setForm({ ...form, packageId: value })
                      }
                      disabled={!form.categoryId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {packagesForCategory(form.categoryId).map((pkg) => (
                          <SelectItem key={pkg.id} value={pkg.id}>
                            {TIER_LABEL[pkg.tier]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {form.durationMonths ? (
                <div className="grid gap-1.5">
                  <Label>Duration</Label>
                  <Select
                    value={String(form.durationMonths)}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        durationMonths: Number(value) as 3 | 6 | 12,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TERM_MONTHS.map((months) => (
                        <SelectItem key={months} value={String(months)}>
                          {termLabel(months)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="rounded-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Retired duration: {form.legacyLabel}. It can stay active for
                  existing holders only.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="term-price">Price ($)</Label>
                  <Input
                    id="term-price"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.price}
                    onChange={(e) =>
                      setForm({ ...form, price: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="term-discount">Discount</Label>
                  <Input
                    id="term-discount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.discount}
                    onChange={(e) =>
                      setForm({ ...form, discount: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Discount type</Label>
                <Select
                  value={form.discountType}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      discountType: value as "percent" | "amount",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent</SelectItem>
                    <SelectItem value="amount">Amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  className="data-checked:bg-[#00a0e9]"
                  checked={form.isActive}
                  disabled={form.durationMonths === null}
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
              disabled={saving || (!form?.id && !form?.packageId)}
              onClick={() => form && void saveTerm(form)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}
