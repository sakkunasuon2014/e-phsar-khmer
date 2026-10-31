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
import { SelectItem } from "@/components/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminCategories,
  type AdminCategory,
} from "@/actions/admin-categories";
import {
  getAdminSubcategories,
  type AdminSubcategory,
} from "@/actions/admin-subcategories";
import {
  createsubcategories,
  updatesubcategories,
  deletesubcategories,
} from "@/actions/subcaetgory";
import { useAppForm } from "@/components/form/hooks";
import { subCategorySchema } from "@/schemas/subcategories";
import { subCategory } from "@/types/subcategory";
import { z } from "zod";
import { toast } from "@/components/ui/sonner";
import { FieldGroup } from "@/components/ui/field";
import { ImageUpload } from "@/components/dashboard/image-upload";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminFilter,
  AdminSearch,
  AdminTable,
  DateCell,
  EntityChip,
  PrimaryCell,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";

type SubCategoryFormData = z.infer<typeof subCategorySchema>;

type SubCategoryWithDates = subCategory & {
  createdAt: string;
  updatedAt: string;
  nameKm: string;
};

type SubcategoryWithMeta = {
  subId: string;
  name: string;
  nameKm: string;
  slug: string;
  subIcon: string;
  categoryId: string;
  createdAt: string;
  updatedAt: string;
};
function AddSubCategoryForm({
  categories,
  onSuccess,
  onCancel,
}: {
  categories: AdminCategory[];
  onSuccess: (data: SubCategoryFormData) => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: {
      name: "",
      nameKm: "",
      slug: "",
      subIcon: "",
      categoryId: "",
    } satisfies SubCategoryFormData as SubCategoryFormData,
    validators: {
      onSubmit: subCategorySchema,
      onChange: subCategorySchema,
    },
    onSubmit: async ({ value }) => {
      const res = await createsubcategories(value);
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
        <form.AppField name="subIcon">
          {(field) => (
            <ImageUpload
              scope="subcategory"
              value={field.state.value}
              onChange={(url) => form.setFieldValue("subIcon", url)}
              label="Icon"
            />
          )}
        </form.AppField>
        <form.AppField name="categoryId">
          {(field) => (
            <field.Select label="Category" required>
              {categories.map((category) => (
                <SelectItem key={category.cateId} value={category.cateId}>
                  {category.name}
                </SelectItem>
              ))}
            </field.Select>
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

function EditSubCategoryForm({
  category,
  categories,
  onSuccess,
  onCancel,
}: {
  category: SubCategoryWithDates;
  categories: AdminCategory[];
  onSuccess: (data: SubCategoryFormData) => void;
  onCancel: () => void;
}) {
  const form = useAppForm({
    defaultValues: {
      name: category.name,
      nameKm: category.nameKm,
      slug: category.slug,
      subIcon: category.subIcon,
      categoryId: category.categoryId,
    } satisfies SubCategoryFormData as SubCategoryFormData,
    validators: {
      onSubmit: subCategorySchema,
      onChange: subCategorySchema,
    },
    onSubmit: async ({ value }) => {
      const res = await updatesubcategories(category.subId, value);
      if (res.success) {
        onSuccess(value);
      } else {
        toast.error(res.error ?? "Failed to update subcategory");
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

        <form.AppField name="subIcon">
          {(field) => (
            <ImageUpload
              scope="subcategory"
              value={field.state.value}
              onChange={(url) => form.setFieldValue("subIcon", url)}
              label="Icon"
            />
          )}
        </form.AppField>
        <form.AppField name="categoryId">
          {(field) => (
            <field.Select label="Category" required>
              {categories.map((category) => (
                <SelectItem key={category.cateId} value={category.cateId}>
                  {category.name}
                </SelectItem>
              ))}
            </field.Select>
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
function DeleteSubCategoryForm({
  category,
  onSuccess,
  onCancel,
}: {
  category: SubCategoryWithDates;
  onSuccess: (data: SubcategoryWithMeta) => void;
  onCancel: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    try {
      setIsDeleting(true);

      const res = await deletesubcategories(category.subId);

      if (res?.success) {
        onSuccess(category);
      } else {
        toast.error("Failed to delete subcategory");
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
        <DialogTitle>Delete Subcategory</DialogTitle>
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
export default function SubCategoriesClient() {
  const queryClient = useQueryClient();
  const { data: subCategories = [], isLoading } = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });
  const { data: categoryList = [] } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: getAdminCategories,
  });
  const refreshSubcategories = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "subcategories"] });

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedSubCategory, setSelectedSubCategory] =
    useState<SubcategoryWithMeta | null>(null);

  const categoryById = useMemo(
    () => new Map(categoryList.map((category) => [category.cateId, category])),
    [categoryList],
  );

  const filteredSubCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return subCategories.filter((subcategory) => {
      if (
        categoryFilter !== "all" &&
        subcategory.categoryId !== categoryFilter
      ) {
        return false;
      }
      if (!query) return true;
      return [
        subcategory.name,
        subcategory.nameKm,
        subcategory.slug,
        categoryById.get(subcategory.categoryId)?.name ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [subCategories, searchQuery, categoryFilter, categoryById]);

  const categoryOptions = categoryList.map((category) => ({
    value: category.cateId,
    label: category.name,
  }));

  const handleAddSuccess = () => {
    refreshSubcategories();
    setIsAddDialogOpen(false);
    toast.success("Subcategory added successfully");
  };

  const handleEditSuccess = () => {
    if (!selectedSubCategory) return;
    refreshSubcategories();
    setSelectedSubCategory(null);
    setIsEditDialogOpen(false);
    toast.success("Subcategory updated successfully");
  };

  const handleDeleteSuccess = () => {
    if (!selectedSubCategory) return;
    const name = selectedSubCategory.name;
    refreshSubcategories();
    setSelectedSubCategory(null);
    setIsDeleteDialogOpen(false);
    toast.success(`Subcategory "${name}" deleted successfully`);
  };

  const openEditDialog = (subcategory: SubcategoryWithMeta) => {
    setSelectedSubCategory(subcategory);
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (subcategory: SubcategoryWithMeta) => {
    setSelectedSubCategory(subcategory);
    setIsDeleteDialogOpen(true);
  };

  const columns = useMemo<AdminColumn<AdminSubcategory>[]>(
    () => [
      {
        key: "subcategory",
        header: "Sub Category",
        sortValue: (subcategory) => subcategory.name,
        cell: (subcategory) => (
          <PrimaryCell
            image={subcategory.subIcon}
            alt={subcategory.name}
            title={subcategory.name}
            subtitle={subcategory.nameKm || undefined}
          />
        ),
      },
      {
        key: "category",
        header: "Category",
        sortValue: (subcategory) =>
          categoryById.get(subcategory.categoryId)?.name ?? "",
        cell: (subcategory) => (
          <EntityChip tone="category">
            {categoryById.get(subcategory.categoryId)?.name ?? "Unknown"}
          </EntityChip>
        ),
      },
      {
        key: "slug",
        header: "Slug",
        sortValue: (subcategory) => subcategory.slug,
        cell: (subcategory) => (
          <span className="text-muted-foreground">{subcategory.slug}</span>
        ),
      },
      {
        key: "updated",
        header: "Updated",
        sortValue: (subcategory) => subcategory.updatedAt,
        cell: (subcategory) => <DateCell value={subcategory.updatedAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (subcategory) => (
          <RowActions
            id={subcategory.subId}
            actions={[
              {
                label: "Edit",
                icon: <Pencil className="mr-2 size-4" />,
                tone: "warning",
                onSelect: () => openEditDialog(subcategory),
              },
              {
                label: "Delete",
                icon: <Trash2 className="mr-2 size-4" />,
                tone: "danger",
                onSelect: () => openDeleteDialog(subcategory),
              },
            ]}
          />
        ),
      },
    ],
    [categoryById],
  );

  return (
    <>
      <AdminPage
        title="Sub Categories"
        description="Manage product subcategories"
        action={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer">
                <Plus className="mr-2 size-4" />
                Add Sub Category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Sub Category</DialogTitle>
                <DialogDescription>
                  Create a new sub category for your products.
                </DialogDescription>
              </DialogHeader>
              {isAddDialogOpen && (
                <AddSubCategoryForm
                  categories={categoryList}
                  onSuccess={handleAddSuccess}
                  onCancel={() => setIsAddDialogOpen(false)}
                />
              )}
            </DialogContent>
          </Dialog>
        }
        toolbar={
          <>
            <AdminSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search sub category, category, slug..."
            />
            <AdminFilter
              value={categoryFilter}
              onChange={setCategoryFilter}
              allLabel="All Categories"
              options={categoryOptions}
            />
          </>
        }
      >
        <AdminTable
          columns={columns}
          rows={filteredSubCategories}
          rowKey={(subcategory) => subcategory.subId}
          isLoading={isLoading}
          pageSize={20}
          resetKey={`${searchQuery}:${categoryFilter}`}
          emptyTitle="No sub category found"
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>
      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Sub Category</DialogTitle>
            <DialogDescription>
              Make changes to the sub category details.
            </DialogDescription>
          </DialogHeader>
          {isEditDialogOpen && selectedSubCategory && (
            <EditSubCategoryForm
              key={selectedSubCategory.subId}
              category={selectedSubCategory}
              categories={categoryList}
              onSuccess={handleEditSuccess}
              onCancel={() => setIsEditDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          {isDeleteDialogOpen && selectedSubCategory && (
            <DeleteSubCategoryForm
              key={selectedSubCategory.subId}
              category={selectedSubCategory}
              onSuccess={handleDeleteSuccess}
              onCancel={() => setIsDeleteDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
