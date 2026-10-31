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
import { modelSchema } from "@/schemas/model";
import { useAppForm } from "@/components/form/hooks";
import {
  FieldGroup,
  FieldContent,
  FieldLegend,
  FieldDescription,
  FieldSet,
} from "@/components/ui/field";
import { toast } from "@/components/ui/sonner";
import { createModel, updateModel, deleteModel } from "@/actions/model";
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
import { getAdminModels } from "@/actions/admin-models";
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
import type { Brand } from "@/types/brand";
import z from "zod";
import { Model } from "@/types/model";

type ModelFormData = z.infer<typeof modelSchema>;

/** Brands that can carry a model in any of the selected subcategories. */
function getBrandsForSelectedSubcategories(
  brands: Brand[],
  subcategoryIds: string[],
) {
  if (subcategoryIds.length === 0) return [];
  // The overlap alone is the test. A brand's `categoryId` is only the first
  // category among its links, so checking it hides legitimate brands whose
  // first link sits in another category (Apple carries phones AND computers).
  return brands.filter((brand) =>
    subcategoryIds.some((id) => brand.subcategories.includes(id)),
  );
}

/** A model's categories come from its own subcategory rows, never from the brand. */
function modelCategoryNames(
  model: Model,
  subcategoryById: Map<string, AdminSubcategory>,
  categoryById: Map<string, AdminCategory>,
): string[] {
  return [
    ...new Set(
      model.subcategories
        .map((id) => subcategoryById.get(id))
        .filter((sub): sub is AdminSubcategory => sub !== undefined)
        .map((sub) => sub.categoryId),
    ),
  ]
    .map((id) => categoryById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

function modelSubcategoryNames(
  model: Model,
  subcategoryById: Map<string, AdminSubcategory>,
): string[] {
  return model.subcategories
    .map((id) => subcategoryById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
}

function AddModelForm({
  categories,
  subcategories,
  brands,
  onSuccess,
  onCancel,
}: {
  categories: AdminCategory[];
  subcategories: AdminSubcategory[];
  brands: Brand[];
  onSuccess: (data: ModelFormData) => void;
  onCancel: () => void;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<
    string[]
  >([]);

  const filteredBrands =
    selectedSubcategoryIds.length > 0
      ? getBrandsForSelectedSubcategories(brands, selectedSubcategoryIds)
      : [];

  const form = useAppForm({
    defaultValues: {
      name: "",
      slug: "",
      brandId: "",
      categoryId: "",
      subcategories: [] as string[],
    } satisfies ModelFormData as ModelFormData,
    validators: {
      onSubmit: modelSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await createModel(value);
      if (res.success) {
        onSuccess(value);
      } else {
        toast.error(res.error ?? "Failed to add model");
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

        {/* Step 1: Select Category */}
        <form.AppField name="categoryId">
          {(field) => (
            <field.Select
              label="Category"
              required
              onValueChange={(value) => {
                setSelectedCategoryId(value);
                // Reset subcategory and brand when category changes
                setSelectedSubcategoryIds([]);
                form.setFieldValue("subcategories", []);
                form.setFieldValue("brandId", "");
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

        {/* Step 2: Select Subcategory (only shows after category is selected) */}
        {selectedCategoryId ? (
          <form.AppField name="subcategories">
            {(field) => (
              <FieldSet>
                <FieldContent>
                  <FieldLegend>
                    Subcategory <span className="text-red-500">*</span>
                  </FieldLegend>
                  <FieldDescription>
                    Which subcategories this model belongs to. Pick more than
                    one when it genuinely spans them (a 2-in-1 is a laptop and a
                    tablet) — this is what keeps a model out of the
                    subcategories it does not belong to.
                  </FieldDescription>
                </FieldContent>
                <SubcategoryCheckboxes
                  categoryId={selectedCategoryId}
                  subcategories={subcategories}
                  selectedIds={field.state.value}
                  onChange={(ids) => {
                    setSelectedSubcategoryIds(ids);
                    field.handleChange(ids);
                    // Reset brand when the subcategory set changes
                    form.setFieldValue("brandId", "");
                  }}
                />
              </FieldSet>
            )}
          </form.AppField>
        ) : (
          <FieldSet>
            <FieldContent>
              <FieldLegend>
                Subcategory <span className="text-red-500">*</span>
              </FieldLegend>
              <FieldDescription>
                Select the subcategory for this model.
              </FieldDescription>
            </FieldContent>
          </FieldSet>
        )}

        {/* Step 3: Select Brand (only shows once a subcategory is picked) */}
        {selectedSubcategoryIds.length > 0 ? (
          <form.AppField name="brandId">
            {(field) => (
              <field.Select label="Brand" required>
                {filteredBrands.length > 0 ? (
                  filteredBrands.map((brand) => (
                    <SelectItem key={brand.brandId} value={brand.brandId}>
                      {brand.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="__none" disabled>
                    No brands available
                  </SelectItem>
                )}
              </field.Select>
            )}
          </form.AppField>
        ) : selectedCategoryId ? (
          <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
            Choose a subcategory to see brands.
          </p>
        ) : null}
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

function EditModelForm({
  model,
  categories,
  subcategories,
  brands,
  onSuccess,
  onCancel,
}: {
  model: Model;
  categories: AdminCategory[];
  subcategories: AdminSubcategory[];
  brands: Brand[];
  onSuccess: (data: ModelFormData) => void;
  onCancel: () => void;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    model.categoryId,
  );
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<
    string[]
  >(model.subcategories);

  const filteredBrands =
    selectedSubcategoryIds.length > 0
      ? getBrandsForSelectedSubcategories(brands, selectedSubcategoryIds)
      : [];

  const form = useAppForm({
    defaultValues: {
      name: model.name,
      slug: model.slug,
      brandId: model.brandId,
      categoryId: model.categoryId,
      subcategories: model.subcategories,
    } satisfies ModelFormData as ModelFormData,
    validators: {
      onSubmit: modelSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await updateModel(model.modelId, value);
      if (res.success) {
        onSuccess(value);
      } else {
        toast.error(res.error ?? "Failed to update model");
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

        {/* Step 1: Select Category */}
        <form.AppField name="categoryId">
          {(field) => (
            <field.Select
              label="Category"
              required
              onValueChange={(value) => {
                setSelectedCategoryId(value);
                // Reset subcategory and brand when category changes
                setSelectedSubcategoryIds([]);
                form.setFieldValue("subcategories", []);
                form.setFieldValue("brandId", "");
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

        {/* Step 2: Select Subcategory */}
        {selectedCategoryId ? (
          <form.AppField name="subcategories">
            {(field) => (
              <FieldSet>
                <FieldContent>
                  <FieldLegend>
                    Subcategory <span className="text-red-500">*</span>
                  </FieldLegend>
                  <FieldDescription>
                    Which subcategories this model belongs to. Pick more than
                    one when it genuinely spans them (a 2-in-1 is a laptop and a
                    tablet) — this is what keeps a model out of the
                    subcategories it does not belong to.
                  </FieldDescription>
                </FieldContent>
                <SubcategoryCheckboxes
                  categoryId={selectedCategoryId}
                  subcategories={subcategories}
                  selectedIds={field.state.value}
                  onChange={(ids) => {
                    setSelectedSubcategoryIds(ids);
                    field.handleChange(ids);
                    // Reset brand when the subcategory set changes
                    form.setFieldValue("brandId", "");
                  }}
                />
              </FieldSet>
            )}
          </form.AppField>
        ) : (
          <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
            Choose a category to see subcategories.
          </p>
        )}

        {/* Step 3: Select Brand (filtered) */}
        {selectedSubcategoryIds.length > 0 ? (
          <form.AppField name="brandId">
            {(field) => (
              <field.Select label="Brand" required>
                {filteredBrands.length > 0 ? (
                  filteredBrands.map((brand) => (
                    <SelectItem key={brand.brandId} value={brand.brandId}>
                      {brand.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="__none" disabled>
                    No brands available
                  </SelectItem>
                )}
              </field.Select>
            )}
          </form.AppField>
        ) : selectedCategoryId ? (
          <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
            Choose a subcategory to see brands.
          </p>
        ) : null}
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

function DeleteModelForm({
  model,
  onSuccess,
  onCancel,
}: {
  model: Model;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    try {
      setIsDeleting(true);
      const res = await deleteModel({ modelId: model.modelId });

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
        <DialogTitle>Delete Model</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete &quot;{model.name}&quot;? This action
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

export default function ModelsPage() {
  const queryClient = useQueryClient();
  const { data: modelList = [], isLoading } = useQuery({
    queryKey: ["admin", "models"],
    queryFn: getAdminModels,
  });
  const { data: allBrands = [] } = useQuery({
    queryKey: ["admin", "brands"],
    queryFn: getAdminBrands,
  });
  const { data: allCategories = [] } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: getAdminCategories,
  });
  const { data: allSubcategories = [] } = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });
  const refreshModels = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "models"] });

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");

  // Dialog States
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);

  const brandById = useMemo(
    () => new Map(allBrands.map((brand) => [brand.brandId, brand])),
    [allBrands],
  );
  const subcategoryById = useMemo(
    () => new Map(allSubcategories.map((sub) => [sub.subId, sub])),
    [allSubcategories],
  );
  const categoryById = useMemo(
    () => new Map(allCategories.map((category) => [category.cateId, category])),
    [allCategories],
  );

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return modelList.filter((model) => {
      const matchesCategory =
        categoryFilter === "all" ||
        model.subcategories.some(
          (id) => subcategoryById.get(id)?.categoryId === categoryFilter,
        );
      if (!matchesCategory) return false;
      if (brandFilter !== "all" && model.brandId !== brandFilter) return false;
      if (!query) return true;
      return [
        model.name,
        model.slug,
        brandById.get(model.brandId)?.name ?? "",
        ...modelSubcategoryNames(model, subcategoryById),
        ...modelCategoryNames(model, subcategoryById, categoryById),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [
    modelList,
    searchQuery,
    categoryFilter,
    brandFilter,
    brandById,
    subcategoryById,
    categoryById,
  ]);

  const categoryOptions = allCategories.map((category) => ({
    value: category.cateId,
    label: category.name,
  }));
  const brandOptions = allBrands.map((brand) => ({
    value: brand.brandId,
    label: brand.name,
  }));

  const handleAdd = (data: ModelFormData) => {
    refreshModels();
    setIsAddDialogOpen(false);
    toast.success(`Model "${data.name}" created successfully!`);
  };

  const handleEdit = (data: ModelFormData) => {
    if (!selectedModel) return;
    refreshModels();
    setSelectedModel(null);
    setIsEditDialogOpen(false);
    toast.success(`Model "${data.name}" updated successfully!`);
  };

  const handleDelete = () => {
    if (!selectedModel) return;
    const name = selectedModel.name;
    refreshModels();
    setSelectedModel(null);
    setIsDeleteDialogOpen(false);
    toast.success(`Model "${name}" deleted successfully!`);
  };

  const openEditDialog = (model: Model) => {
    setSelectedModel(model);
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (model: Model) => {
    setSelectedModel(model);
    setIsDeleteDialogOpen(true);
  };

  const columns = useMemo<AdminColumn<Model>[]>(
    () => [
      {
        key: "model",
        header: "Model",
        sortValue: (model) => model.name,
        cell: (model) => (
          <PrimaryCell
            image={brandById.get(model.brandId)?.image}
            alt={brandById.get(model.brandId)?.name ?? model.name}
            title={model.name}
            subtitle={brandById.get(model.brandId)?.name ?? "—"}
          />
        ),
      },
      {
        key: "category",
        header: "Category",
        sortValue: (model) =>
          modelCategoryNames(model, subcategoryById, categoryById).join(", "),
        cell: (model) => (
          <ChipList
            items={modelCategoryNames(model, subcategoryById, categoryById)}
            tone="category"
          />
        ),
      },
      {
        key: "subcategories",
        header: "Sub Categories",
        sortValue: (model) =>
          modelSubcategoryNames(model, subcategoryById).join(", "),
        cell: (model) => (
          <ChipList items={modelSubcategoryNames(model, subcategoryById)} />
        ),
      },
      {
        key: "updated",
        header: "Updated",
        sortValue: (model) => model.updatedAt,
        cell: (model) => <DateCell value={model.updatedAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (model) => (
          <RowActions
            id={model.modelId}
            actions={[
              {
                label: "Edit",
                icon: <Pencil className="mr-2 size-4" />,
                tone: "warning",
                onSelect: () => openEditDialog(model),
              },
              {
                label: "Delete",
                icon: <Trash2 className="mr-2 size-4" />,
                tone: "danger",
                onSelect: () => openDeleteDialog(model),
              },
            ]}
          />
        ),
      },
    ],
    [brandById, subcategoryById, categoryById],
  );

  return (
    <>
      <AdminPage
        title="Models"
        description="Manage product models here."
        action={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer">
                <Plus className="mr-2 size-4" />
                Add Model
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Model</DialogTitle>
                <DialogDescription>
                  Create a new Model for your products.
                </DialogDescription>
              </DialogHeader>
              {isAddDialogOpen && (
                <AddModelForm
                  categories={allCategories}
                  subcategories={allSubcategories}
                  brands={allBrands}
                  onSuccess={handleAdd}
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
              placeholder="Search model, brand, category..."
            />
            <AdminFilter
              value={categoryFilter}
              onChange={setCategoryFilter}
              allLabel="All Categories"
              options={categoryOptions}
            />
            <AdminFilter
              value={brandFilter}
              onChange={setBrandFilter}
              allLabel="All Brands"
              options={brandOptions}
            />
          </>
        }
      >
        <AdminTable
          columns={columns}
          rows={filteredModels}
          rowKey={(model) => model.modelId}
          isLoading={isLoading}
          pageSize={20}
          resetKey={`${searchQuery}:${categoryFilter}:${brandFilter}`}
          emptyTitle="No model found"
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>
      {/* Edit Dialog Block */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Model</DialogTitle>
            <DialogDescription>
              Make changes to the Model details.
            </DialogDescription>
          </DialogHeader>
          {isEditDialogOpen && selectedModel && (
            <EditModelForm
              key={selectedModel.modelId}
              model={selectedModel}
              categories={allCategories}
              subcategories={allSubcategories}
              brands={allBrands}
              onSuccess={handleEdit}
              onCancel={() => setIsEditDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      {/* Delete Dialog Block */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          {isDeleteDialogOpen && selectedModel && (
            <DeleteModelForm
              key={selectedModel.brandId}
              model={selectedModel}
              onSuccess={handleDelete}
              onCancel={() => setIsDeleteDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
