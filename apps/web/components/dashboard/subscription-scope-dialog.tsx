"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { useAdminCategoryTree } from "@/hooks/use-admin-category-tree";
import {
  updateSubCategoryScope,
  type SubCategory,
} from "@/actions/admin-subscriptions";

/**
 * Picks the listing subcategories a subscription category (group) covers.
 * Ads posted there count against the group's package; a subcategory already
 * in another group is shown but locked — the backend refuses to move it, so
 * one edit can never silently shift another group's subscribers.
 */
export function SubscriptionScopeDialog({
  group,
  groups,
  onClose,
  onSaved,
}: {
  group: SubCategory;
  groups: SubCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { tree: categoryTree } = useAdminCategoryTree();
  const [selected, setSelected] = useState(
    () => new Set(group.subcategoryIds ?? []),
  );
  const [saving, setSaving] = useState(false);

  const takenBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const other of groups) {
      if (other.id === group.id) continue;
      for (const id of other.subcategoryIds ?? []) map.set(id, other.name);
    }
    return map;
  }, [groups, group.id]);

  const tree = categoryTree.filter((category) => category.subs.length > 0);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const save = async () => {
    setSaving(true);
    const res = await updateSubCategoryScope(group.id, [...selected]);
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(`${group.name} now covers ${selected.size} subcategories`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>What {group.name} covers</DialogTitle>
          <DialogDescription>
            Ads posted in the ticked subcategories count against this
            category&apos;s packages. Everything unticked uses the free plan
            unless another category covers it. Changes apply to current
            subscribers too.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 max-h-[55vh] space-y-5 overflow-y-auto px-6">
          {tree.map((category) => {
            const free = category.subs.filter((s) => !takenBy.has(s.subId));
            const ids = free.map((s) => s.subId);
            const ticked = ids.filter((id) => selected.has(id)).length;
            return (
              <section key={category.cateId}>
                <label
                  className={`flex items-center gap-2 border-b pb-2 text-sm font-semibold ${ids.length === 0 ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer"}`}
                >
                  <Checkbox
                    checked={
                      ticked === 0
                        ? false
                        : ticked === ids.length
                          ? true
                          : "indeterminate"
                    }
                    disabled={ids.length === 0}
                    onCheckedChange={(value) => toggle(ids, value === true)}
                  />
                  {category.name}
                  <span className="font-normal text-muted-foreground">
                    {ticked}/{category.subs.length}
                  </span>
                </label>
                <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 md:grid-cols-3">
                  {category.subs.map((sub) => {
                    const owner = takenBy.get(sub.subId);
                    return (
                      <label
                        key={sub.subId}
                        className={`flex items-center gap-2 text-sm ${owner ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer"}`}
                      >
                        <Checkbox
                          checked={owner ? false : selected.has(sub.subId)}
                          disabled={!!owner}
                          onCheckedChange={(value) =>
                            toggle([sub.subId], value === true)
                          }
                        />
                        <span className="truncate">{sub.name}</span>
                        {owner && (
                          <span className="shrink-0 rounded bg-muted px-1.5 text-xs">
                            {owner}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <Button
              className="h-9 rounded-sm bg-red-500 text-white hover:bg-red-600"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save coverage"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
