"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { AdminSubcategory } from "@/actions/admin-subcategories";

/**
 * Checkbox list of a category's subcategories, bound to a `string[]`.
 *
 * Extracted from the brands page so the models page shares it — both record a
 * many-to-many link to subcategories (`brand_subcategory_links`,
 * `model_subcategory_links`), so both need a multi-select rather than a
 * single-value dropdown.
 */
export function SubcategoryCheckboxes({
  categoryId,
  subcategories,
  selectedIds,
  onChange,
}: {
  categoryId: string;
  subcategories: AdminSubcategory[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const filteredSubcategories = subcategories.filter(
    (sub) => sub.categoryId === categoryId,
  );

  if (filteredSubcategories.length === 0) {
    return (
      <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
        No subcategories available for this category.
      </p>
    );
  }
  return (
    <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-2">
      {filteredSubcategories.map((sub) => (
        <label
          key={sub.subId}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer type-body-sm"
        >
          <Checkbox
            checked={selectedIds.includes(sub.subId)}
            onCheckedChange={(checked) => {
              if (checked) {
                onChange([...selectedIds, sub.subId]);
              } else {
                onChange(selectedIds.filter((id) => id !== sub.subId));
              }
            }}
          />
          <span>{sub.name}</span>
        </label>
      ))}
    </div>
  );
}
