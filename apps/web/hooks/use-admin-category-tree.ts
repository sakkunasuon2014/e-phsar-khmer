"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAdminCategories } from "@/actions/admin-categories";
import { getAdminSubcategories } from "@/actions/admin-subcategories";

export function useAdminCategoryTree() {
  const categoriesQuery = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: getAdminCategories,
  });
  const subcategoriesQuery = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });
  const tree = useMemo(
    () =>
      [...(categoriesQuery.data ?? [])]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => ({
          ...category,
          subs: (subcategoriesQuery.data ?? [])
            .filter((sub) => sub.categoryId === category.cateId)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        })),
    [categoriesQuery.data, subcategoriesQuery.data],
  );

  return {
    tree,
    isLoading: categoriesQuery.isLoading || subcategoriesQuery.isLoading,
  };
}
