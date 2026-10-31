"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { toast } from "@/components/ui/sonner";
import { useAdminCategoryTree } from "@/hooks/use-admin-category-tree";
import {
  getFreePlan,
  updateFreePlan,
  type FreePlan,
} from "@/actions/admin-subscriptions";

const SETTINGS: {
  key: Exclude<keyof FreePlan, "adLimits">;
  label: string;
  hint: string;
}[] = [
  { key: "photos", label: "Photos per ad", hint: "Every free ad" },
  { key: "renews", label: "Renews per ad", hint: "Every free ad" },
  { key: "videos", label: "Videos per ad", hint: "Not enforced yet" },
  { key: "autoRenews", label: "Auto-renews", hint: "Not enforced yet" },
  {
    key: "otherAds",
    label: "Total ads",
    hint: "Account-wide cap on live ads",
  },
];

/** A cap row's scope as one select value: `sub:<id>` or `cat:<id>`. */
type Row = { scope: string; ads: number };

function toRows(plan: FreePlan): Row[] {
  return plan.adLimits.map((limit) => ({
    scope: limit.subcategoryId
      ? `sub:${limit.subcategoryId}`
      : `cat:${limit.categoryId}`,
    ads: limit.ads,
  }));
}

function FreePlanForm({ plan }: { plan: FreePlan }) {
  const queryClient = useQueryClient();
  const { tree } = useAdminCategoryTree();
  const [settings, setSettings] = useState(() => ({
    photos: plan.photos,
    renews: plan.renews,
    autoRenews: plan.autoRenews,
    videos: plan.videos,
    otherAds: plan.otherAds,
  }));
  const [rows, setRows] = useState<Row[]>(() => toRows(plan));
  const [saving, setSaving] = useState(false);

  const used = new Set(rows.map((row) => row.scope));
  const duplicate = rows.some(
    (row, i) => rows.findIndex((other) => other.scope === row.scope) !== i,
  );
  const incomplete = rows.some((row) => !row.scope);

  const save = async () => {
    setSaving(true);
    const res = await updateFreePlan({
      ...settings,
      adLimits: rows.map((row) => {
        const [kind, id] = row.scope.split(":");
        return kind === "sub"
          ? { categoryId: null, subcategoryId: id, ads: row.ads }
          : { categoryId: id, subcategoryId: null, ads: row.ads };
      }),
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Free plan saved — ads are being re-checked");
    queryClient.invalidateQueries({ queryKey: ["admin", "sub", "free-plan"] });
  };

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold">Account-wide limits</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SETTINGS.map(({ key, label, hint }) => (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={`free-${key}`}>{label}</Label>
              <Input
                id={`free-${key}`}
                type="number"
                min={0}
                value={settings[key]}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    [key]: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
              <span className="text-xs text-muted-foreground">{hint}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Ad caps by category</h2>
          <p className="text-sm text-muted-foreground">
            Caps sit inside the account-wide &ldquo;Total ads&rdquo;: at most
            this many of a free user&apos;s live ads may be in one place. A
            subcategory cap beats its category&apos;s cap, and a number above
            the total never binds. A subscription covering a subcategory
            replaces both for its subscribers.
          </p>
        </div>
        <div className="divide-y rounded-lg border">
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No caps — every free ad shares &ldquo;Other ads&rdquo;.
            </p>
          )}
          {rows.map((row, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <NativeSelect
                value={row.scope}
                onChange={(e) => setRow(index, { scope: e.target.value })}
                className="min-w-64"
                aria-label="Category or subcategory"
              >
                <NativeSelectOption value="">Choose where…</NativeSelectOption>
                {tree.map((category) => (
                  <NativeSelectOptGroup
                    key={category.cateId}
                    label={category.name}
                  >
                    <NativeSelectOption
                      value={`cat:${category.cateId}`}
                      disabled={
                        used.has(`cat:${category.cateId}`) &&
                        row.scope !== `cat:${category.cateId}`
                      }
                    >
                      All of {category.name}
                    </NativeSelectOption>
                    {category.subs.map((sub) => (
                      <NativeSelectOption
                        key={sub.subId}
                        value={`sub:${sub.subId}`}
                        disabled={
                          used.has(`sub:${sub.subId}`) &&
                          row.scope !== `sub:${sub.subId}`
                        }
                      >
                        {sub.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  value={row.ads}
                  aria-label="Ads allowed"
                  onChange={(e) =>
                    setRow(index, {
                      ads: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
                <span className="text-sm text-muted-foreground">ads</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove cap"
                className="ml-auto text-destructive"
                onClick={() =>
                  setRows((current) => current.filter((_, i) => i !== index))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="h-9 rounded-sm"
          onClick={() =>
            setRows((current) => [...current, { scope: "", ads: 0 }])
          }
        >
          <Plus className="mr-2 size-4" /> Add cap
        </Button>
      </section>

      <div className="flex items-center gap-3 border-t pt-6">
        <Button
          className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600"
          onClick={save}
          disabled={saving || duplicate || incomplete}
        >
          {saving ? "Saving…" : "Save free plan"}
        </Button>
        {(duplicate || incomplete) && (
          <span className="text-sm text-destructive">
            {incomplete
              ? "Choose where each cap applies."
              : "A category is capped twice."}
          </span>
        )}
      </div>
    </div>
  );
}

export default function FreePlanPage() {
  const { data: plan, error } = useQuery({
    queryKey: ["admin", "sub", "free-plan"],
    queryFn: getFreePlan,
  });

  return (
    <main className="space-y-6 p-6">
      <div>
        <h1 className="type-page-title text-sky-500">Free Plan</h1>
        <p className="text-sm text-muted-foreground">
          What every account gets without a subscription. Saving re-checks every
          seller&apos;s ads against the new limits.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load the free plan.
        </p>
      ) : plan ? (
        <FreePlanForm key={JSON.stringify(plan)} plan={plan} />
      ) : (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      )}
    </main>
  );
}
