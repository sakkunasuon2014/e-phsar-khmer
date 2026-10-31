"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminCategories } from "@/actions/admin-categories";
import { getAdminSubcategories } from "@/actions/admin-subcategories";
import { ImageUpload } from "@/components/dashboard/image-upload";
import type { Category } from "@/types/category";
import {
  createcategories,
  updatecategories,
  deletecategories,
} from "@/actions/category";
import { useAppForm } from "@/components/form/hooks";
import { categorySchema } from "@/schemas/category";
import { FieldGroup } from "@/components/ui/field";
import { toast } from "@/components/ui/sonner";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminSearch,
  AdminTable,
  DateCell,
  PrimaryCell,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";
import { z } from "zod";

type CategoryFormData = z.infer<typeof categorySchema>;

type CategoryWithDates = Category & {
  createdAt: string;
  updatedAt: string;
  nameKm: string;
};

function AddCategoryForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (data: CategoryFormData) => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: {
      name: "",
      nameKm: "",
      slug: "",
      cateIcon: "",
    } satisfies CategoryFormData as CategoryFormData,
    validators: {
      onSubmit: categorySchema,
      onChange: categorySchema,
    },
    onSubmit: async ({ value }) => {
      const res = await createcategories(value);
      if (res.success) {
        onSuccess(value);
      } else {
        toast.error("Failed to add category");
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup className="py-4">
        <form.AppField name="name">
          {(field) => <field.Input label="Name" required />}
        </form.AppField>

        <form.AppField name="nameKm">
          {(field) => <field.Input label="Khmer name" />}
        </form.AppField>

        <form.AppField name="slug">
          {(field) => <field.Input label="Slug" required />}
        </form.AppField>
        <form.AppField name="cateIcon">
          {(field) => (
            <ImageUpload
              scope="category"
              value={field.state.value}
              onChange={(url) => form.setFieldValue("cateIcon", url)}
              label="Icon"
            />
          )}
        </form.AppField>
      </FieldGroup>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-sm cursor-pointer"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditCategoryForm({
  category,
  onSuccess,
  onCancel,
}: {
  category: CategoryWithDates;
  onSuccess: (data: CategoryFormData) => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: {
      name: category.name,
      nameKm: category.nameKm,
      slug: category.slug,
      cateIcon: category.cateIcon,
    } satisfies CategoryFormData as CategoryFormData,
    validators: {
      onSubmit: categorySchema,
      onChange: categorySchema,
    },
    onSubmit: async ({ value }) => {
      const res = await updatecategories(category.cateId, value);
      if (res.success) {
        onSuccess(value);
      } else {
        toast.error(res.error ?? "Failed to update category");
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup className="py-4">
        <form.AppField name="name">
          {(field) => <field.Input label="Name" required />}
        </form.AppField>

        <form.AppField name="nameKm">
          {(field) => <field.Input label="Khmer name" />}
        </form.AppField>

        <form.AppField name="slug">
          {(field) => <field.Input label="Slug" required />}
        </form.AppField>

        <form.AppField name="cateIcon">
          {(field) => (
            <ImageUpload
              scope="category"
              value={field.state.value}
              onChange={(url) => form.setFieldValue("cateIcon", url)}
              label="Icon"
            />
          )}
        </form.AppField>
      </FieldGroup>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-sm cursor-pointer"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
        >
          Save Changes
        </Button>
      </DialogFooter>
    </form>
  );
}
function DeleteCategoryForm({
  category,
  onSuccess,
  onCancel,
}: {
  category: CategoryWithDates;
  onSuccess: (data: CategoryWithDates) => void;
  onCancel: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    try {
      setIsDeleting(true);

      const res = await deletecategories({
        cateId: category.cateId,
      });

      if (res?.success) {
        onSuccess(category);
      } else {
        toast.error("error" in res ? res.error : "Failed to delete category");
      }
    } catch (error) {
      console.error("Delete Error:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete Category</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete &quot;{category?.name}&quot;? This
          action cannot be undone.
        </DialogDescription>
      </DialogHeader>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-sm cursor-pointer"
          onClick={onCancel}
          disabled={isDeleting}
        >
          Cancel
        </Button>

        <Button
          type="button"
          variant="destructive"
          className="h-9 rounded-sm bg-red-500 text-white hover:bg-red-600 hover:text-white cursor-pointer"
          onClick={handleDelete}
          disabled={isDeleting}
        >
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
        </Button>
      </DialogFooter>
    </>
  );
}

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const { data: categoryList = [], isLoading } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: getAdminCategories,
  });
  const { data: subcategories = [] } = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });
  const refreshCategories = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });

  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryWithDates | null>(null);

  const subcategoryCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const subcategory of subcategories) {
      counts.set(
        subcategory.categoryId,
        (counts.get(subcategory.categoryId) ?? 0) + 1,
      );
    }
    return counts;
  }, [subcategories]);

  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return categoryList;
    return categoryList.filter((category) =>
      [category.name, category.nameKm, category.slug]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [categoryList, searchQuery]);

  const handleAddSuccess = (data: CategoryFormData) => {
    refreshCategories();
    setIsAddDialogOpen(false);
    toast.success(`Category "${data.name}" created successfully!`);
  };

  const handleEditSuccess = (data: CategoryFormData) => {
    if (!selectedCategory) return;
    refreshCategories();
    setSelectedCategory(null);
    setIsEditDialogOpen(false);
    toast.success(`Category "${data.name}" updated successfully!`);
  };

  const handleDeleteSuccess = () => {
    if (!selectedCategory) return;
    const name = selectedCategory.name;
    refreshCategories();
    setSelectedCategory(null);
    setIsDeleteDialogOpen(false);
    toast.success(`Category "${name}" deleted successfully!`);
  };

  const openEditDialog = (category: CategoryWithDates) => {
    setSelectedCategory(category);
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (category: CategoryWithDates) => {
    setSelectedCategory(category);
    setIsDeleteDialogOpen(true);
  };

  const columns = useMemo<AdminColumn<CategoryWithDates>[]>(
    () => [
      {
        key: "category",
        header: "Category",
        sortValue: (category) => category.name,
        cell: (category) => (
          <PrimaryCell
            image={category.cateIcon}
            alt={category.name}
            title={category.name}
            subtitle={category.nameKm || category.slug}
          />
        ),
      },
      {
        key: "slug",
        header: "Slug",
        sortValue: (category) => category.slug,
        cell: (category) => (
          <span className="text-muted-foreground">{category.slug}</span>
        ),
      },
      {
        key: "subcategories",
        header: "Sub Categories",
        align: "center",
        sortValue: (category) => subcategoryCount.get(category.cateId) ?? 0,
        cell: (category) => (
          <span className="type-body-sm">
            {subcategoryCount.get(category.cateId) ?? 0}
          </span>
        ),
      },
      {
        key: "updated",
        header: "Updated",
        sortValue: (category) => category.updatedAt,
        cell: (category) => <DateCell value={category.updatedAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (category) => (
          <RowActions
            id={category.cateId}
            actions={[
              {
                label: "Edit",
                icon: <Pencil className="mr-2 size-4" />,
                tone: "warning",
                onSelect: () => openEditDialog(category),
              },
              {
                label: "Delete",
                icon: <Trash2 className="mr-2 size-4" />,
                tone: "danger",
                onSelect: () => openDeleteDialog(category),
              },
            ]}
          />
        ),
      },
    ],
    [subcategoryCount],
  );

  return (
    <>
      <AdminPage
        title="Categories"
        description="Manage product categories"
        action={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer">
                <Plus className="mr-2 size-4" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Category</DialogTitle>
                <DialogDescription>
                  Create a new category for your products.
                </DialogDescription>
              </DialogHeader>

              {isAddDialogOpen && (
                <AddCategoryForm
                  onSuccess={handleAddSuccess}
                  onCancel={() => setIsAddDialogOpen(false)}
                />
              )}
            </DialogContent>
          </Dialog>
        }
        toolbar={
          <AdminSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search category name, Khmer name, slug..."
          />
        }
      >
        <AdminTable
          columns={columns}
          rows={filteredCategories}
          rowKey={(category) => category.cateId}
          isLoading={isLoading}
          resetKey={searchQuery}
          emptyTitle="No category found"
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>
      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>
              Make changes to the category details.
            </DialogDescription>
          </DialogHeader>
          {isEditDialogOpen && selectedCategory && (
            <EditCategoryForm
              key={selectedCategory.cateId}
              category={selectedCategory}
              onSuccess={handleEditSuccess}
              onCancel={() => setIsEditDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          {isDeleteDialogOpen && selectedCategory && (
            <DeleteCategoryForm
              key={selectedCategory.cateId}
              category={selectedCategory}
              onSuccess={handleDeleteSuccess}
              onCancel={() => setIsDeleteDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
