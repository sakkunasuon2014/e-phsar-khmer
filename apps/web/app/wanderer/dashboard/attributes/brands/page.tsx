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
import { useAppForm } from "@/components/form/hooks";
import { z } from "zod";
import { toast } from "@/components/ui/sonner";
import {
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { ImageUpload } from "@/components/dashboard/image-upload";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminCategories,
  type AdminCategory,
} from "@/actions/admin-categories";
import {
  getAdminSubcategories,
  type AdminSubcategory,
} from "@/actions/admin-subcategories";
import { getAdminBrands } from "@/actions/admin-brands";
import { brandSchema } from "@/schemas/brand";
import type { Brand } from "@/types/brand";
import { createBrand, deleteBrand, updateBrand } from "@/actions/brand";
import { SubcategoryCheckboxes } from "@/components/dashboard/subcategory-checkboxes";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminFilter,
  AdminSearch,
  AdminTable,
  ChipList,
  DateCell,
  PrimaryCell,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";

type BrandFormData = z.infer<typeof brandSchema>;

/** Every category represented by the brand's subcategory links (a brand may span several). */
function brandCategoryNames(
  brand: Brand,
  subcategoryById: Map<string, AdminSubcategory>,
  categoryById: Map<string, AdminCategory>,
): string[] {
  return [
    ...new Set(
      brand.subcategories
        .map((id) => subcategoryById.get(id)?.categoryId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
    .map((id) => categoryById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

function brandSubcategoryNames(
  brand: Brand,
  subcategoryById: Map<string, AdminSubcategory>,
): string[] {
  return brand.subcategories
    .map((id) => subcategoryById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

function AddBrandForm({
  categories,
  subcategories,
  onSuccess,
  onCancel,
}: {
  categories: AdminCategory[];
  subcategories: AdminSubcategory[];
  onSuccess: (data: BrandFormData) => void;
  onCancel: () => void;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const form = useAppForm({
    defaultValues: {
      name: "",
      slug: "",
      image: "",
      categoryId: "",
      subcategories: [] as string[],
    } satisfies BrandFormData as BrandFormData,
    validators: {
      onSubmit: brandSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await createBrand(value);
      if (res.success) {
        onSuccess(value);
      } else {
        toast.error("Failed to add brand");
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

        <form.AppField name="slug">
          {(field) => <field.Input label="Slug" required />}
        </form.AppField>

        <form.AppField name="image">
          {(field) => (
            <ImageUpload
              scope="brand"
              value={field.state.value}
              onChange={(url) => form.setFieldValue("image", url)}
              label="Logo"
            />
          )}
        </form.AppField>

        <form.AppField name="categoryId">
          {(field) => (
            <field.Select
              label="Category"
              required
              onValueChange={(value) => {
                setSelectedCategoryId(value);
                form.setFieldValue("subcategories", []);
              }}
            >
              {categories.map((category) => (
                <SelectItem key={category.cateId} value={category.cateId}>
                  {category.name}
                </SelectItem>
              ))}
            </field.Select>
          )}
        </form.AppField>

        {selectedCategoryId ? (
          <FieldSet>
            <FieldContent>
              <FieldLegend>Sub Categories</FieldLegend>
              <FieldDescription>
                Select one or more subcategories.
              </FieldDescription>
            </FieldContent>
            <form.AppField name="subcategories">
              {(field) => (
                <SubcategoryCheckboxes
                  categoryId={selectedCategoryId}
                  subcategories={subcategories}
                  selectedIds={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.AppField>
          </FieldSet>
        ) : (
          <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
            Choose a category to see subcategories.
          </p>
        )}
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

function EditBrandForm({
  brand,
  categories,
  subcategories,
  onSuccess,
  onCancel,
}: {
  brand: Brand;
  categories: AdminCategory[];
  subcategories: AdminSubcategory[];
  onSuccess: (data: BrandFormData) => void;
  onCancel: () => void;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    brand.categoryId,
  );

  const form = useAppForm({
    defaultValues: {
      name: brand.name,
      slug: brand.slug,
      image: brand.image,
      categoryId: brand.categoryId,
      subcategories: brand.subcategories,
    } satisfies BrandFormData as BrandFormData,
    validators: {
      onSubmit: brandSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await updateBrand(brand.brandId, value);
      if (res.success) {
        onSuccess(value);
      } else {
        toast.error(res.error ?? "Failed to update brand");
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

        <form.AppField name="slug">
          {(field) => <field.Input label="Slug" required />}
        </form.AppField>

        <form.AppField name="image">
          {(field) => (
            <ImageUpload
              scope="brand"
              value={field.state.value}
              onChange={(url) => form.setFieldValue("image", url)}
              label="Logo"
            />
          )}
        </form.AppField>

        <form.AppField name="categoryId">
          {(field) => (
            <field.Select
              label="Category"
              required
              onValueChange={(value) => {
                setSelectedCategoryId(value);
                form.setFieldValue("subcategories", []);
              }}
            >
              {categories.map((category) => (
                <SelectItem key={category.cateId} value={category.cateId}>
                  {category.name}
                </SelectItem>
              ))}
            </field.Select>
          )}
        </form.AppField>

        {selectedCategoryId ? (
          <FieldSet>
            <FieldContent>
              <FieldLegend>Sub Categories</FieldLegend>
              <FieldDescription>
                Select the subcategories that belong to this brand.
              </FieldDescription>
            </FieldContent>
            <form.AppField name="subcategories">
              {(field) => (
                <SubcategoryCheckboxes
                  categoryId={selectedCategoryId}
                  subcategories={subcategories}
                  selectedIds={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.AppField>
          </FieldSet>
        ) : (
          <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
            Choose a category to see subcategories.
          </p>
        )}
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

function DeleteBrandForm({
  brand,
  onSuccess,
  onCancel,
}: {
  brand: Brand;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    try {
      setIsDeleting(true);
      const res = await deleteBrand({ brandId: brand.brandId });

      if (res.success) {
        onSuccess();
      } else {
        toast.error("error" in res ? res.error : "Failed to delete brand");
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
        <DialogTitle>Delete Brand</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete &quot;{brand.name}&quot;? This action
          cannot be undone.
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
          onClick={handleDelete}
          disabled={isDeleting}
          className="h-9 rounded-sm bg-red-500 text-white hover:bg-red-600 hover:text-white cursor-pointer"
        >
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
        </Button>
      </DialogFooter>
    </>
  );
}

export default function BrandsPage() {
  const queryClient = useQueryClient();
  const { data: brandList = [], isLoading } = useQuery({
    queryKey: ["admin", "brands"],
    queryFn: getAdminBrands,
  });
  const { data: categoryList = [] } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: getAdminCategories,
  });
  const { data: allSubcategories = [] } = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });
  const refreshBrands = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "brands"] });

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);

  const subcategoryById = useMemo(
    () => new Map(allSubcategories.map((sub) => [sub.subId, sub])),
    [allSubcategories],
  );
  const categoryById = useMemo(
    () => new Map(categoryList.map((category) => [category.cateId, category])),
    [categoryList],
  );

  const filteredBrands = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return brandList.filter((brand) => {
      if (
        categoryFilter !== "all" &&
        !brand.subcategories.some(
          (id) => subcategoryById.get(id)?.categoryId === categoryFilter,
        )
      ) {
        return false;
      }
      if (!query) return true;
      return [
        brand.name,
        brand.slug,
        ...brandCategoryNames(brand, subcategoryById, categoryById),
        ...brandSubcategoryNames(brand, subcategoryById),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [brandList, searchQuery, categoryFilter, subcategoryById, categoryById]);

  const categoryOptions = categoryList.map((category) => ({
    value: category.cateId,
    label: category.name,
  }));

  const handleAddSuccess = (data: BrandFormData) => {
    refreshBrands();
    setIsAddDialogOpen(false);
    toast.success(`Brand "${data.name}" created successfully!`);
  };

  const handleEditSuccess = (data: BrandFormData) => {
    if (!selectedBrand) return;
    refreshBrands();
    setSelectedBrand(null);
    setIsEditDialogOpen(false);
    toast.success(`Brand "${data.name}" updated successfully!`);
  };

  const handleDeleteSuccess = () => {
    if (!selectedBrand) return;
    const name = selectedBrand.name;
    refreshBrands();
    setSelectedBrand(null);
    setIsDeleteDialogOpen(false);
    toast.success(`Brand "${name}" deleted successfully!`);
  };

  const openEditDialog = (brand: Brand) => {
    setSelectedBrand(brand);
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (brand: Brand) => {
    setSelectedBrand(brand);
    setIsDeleteDialogOpen(true);
  };

  const columns = useMemo<AdminColumn<Brand>[]>(
    () => [
      {
        key: "brand",
        header: "Brand",
        sortValue: (brand) => brand.name,
        cell: (brand) => (
          <PrimaryCell
            image={brand.image}
            alt={brand.name}
            title={brand.name}
            subtitle={brand.slug}
            imageClassName="object-contain p-0.5"
          />
        ),
      },
      {
        key: "category",
        header: "Categories",
        sortValue: (brand) =>
          brandCategoryNames(brand, subcategoryById, categoryById).join(", "),
        cell: (brand) => (
          <ChipList
            items={brandCategoryNames(brand, subcategoryById, categoryById)}
            tone="category"
          />
        ),
      },
      {
        key: "subcategories",
        header: "Sub Categories",
        sortValue: (brand) =>
          brandSubcategoryNames(brand, subcategoryById).join(", "),
        cell: (brand) => (
          <ChipList items={brandSubcategoryNames(brand, subcategoryById)} />
        ),
      },
      {
        key: "updated",
        header: "Updated",
        sortValue: (brand) => brand.updatedAt,
        cell: (brand) => <DateCell value={brand.updatedAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (brand) => (
          <RowActions
            id={brand.brandId}
            actions={[
              {
                label: "Edit",
                icon: <Pencil className="mr-2 size-4" />,
                tone: "warning",
                onSelect: () => openEditDialog(brand),
              },
              {
                label: "Delete",
                icon: <Trash2 className="mr-2 size-4" />,
                tone: "danger",
                onSelect: () => openDeleteDialog(brand),
              },
            ]}
          />
        ),
      },
    ],
    [subcategoryById, categoryById],
  );

  return (
    <>
      <AdminPage
        title="Brands"
        description="Manage product brands here."
        action={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer">
                <Plus className="mr-2 size-4" />
                Add Brand
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Brand</DialogTitle>
                <DialogDescription>
                  Create a new brand for your products.
                </DialogDescription>
              </DialogHeader>
              {isAddDialogOpen && (
                <AddBrandForm
                  categories={categoryList}
                  subcategories={allSubcategories}
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
              placeholder="Search brand, category, sub category..."
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
          rows={filteredBrands}
          rowKey={(brand) => brand.brandId}
          isLoading={isLoading}
          pageSize={20}
          resetKey={`${searchQuery}:${categoryFilter}`}
          emptyTitle="No brand found"
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Brand</DialogTitle>
            <DialogDescription>
              Make changes to the brand details.
            </DialogDescription>
          </DialogHeader>
          {isEditDialogOpen && selectedBrand && (
            <EditBrandForm
              key={selectedBrand.brandId}
              brand={selectedBrand}
              categories={categoryList}
              subcategories={allSubcategories}
              onSuccess={handleEditSuccess}
              onCancel={() => setIsEditDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          {isDeleteDialogOpen && selectedBrand && (
            <DeleteBrandForm
              key={selectedBrand.brandId}
              brand={selectedBrand}
              onSuccess={handleDeleteSuccess}
              onCancel={() => setIsDeleteDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
