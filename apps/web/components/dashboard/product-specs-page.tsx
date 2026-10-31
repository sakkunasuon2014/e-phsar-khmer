"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { getAdminBrands } from "@/actions/admin-brands";
import { getAdminModels } from "@/actions/admin-models";
import { getAdminProducts } from "@/actions/admin-products";
import { getAdminSubcategories } from "@/actions/admin-subcategories";
import {
  createProduct,
  deleteProduct,
  getProductTemplate,
  updateProduct,
} from "@/actions/product";
import { AdminPage } from "@/components/dashboard/admin-page";
import { ImageUpload } from "@/components/dashboard/image-upload";
import {
  AdminFilter,
  AdminSearch,
  AdminTable,
  DateCell,
  PrimaryCell,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";
import { matchTemplateGroup } from "@/lib/product-spec-families";
import type { Brand } from "@/types/brand";
import type { Model } from "@/types/model";
import type {
  AdminProduct,
  ProductSpecFamily,
  ProductSpecGroup,
  ProductSpecTemplate,
} from "@/types/product";
import { cn } from "@/lib/utils";

/**
 * One field's values, in order. A template field can carry several rows with
 * the same label (a phone's 4G bands differ per regional model), so the draft
 * holds a list per section+field rather than one string.
 */
type SpecValues = Record<string, string[]>;
type GroupValues = { values: SpecValues; legacy: ProductSpecGroup[] };

const valueKey = (sectionKey: string, fieldKey: string) =>
  `${sectionKey}:${fieldKey}`;

/** Replace one value of a draft field. */
function setValueAt(
  values: SpecValues,
  key: string,
  index: number,
  value: string,
): SpecValues {
  const next = [...(values[key] ?? [])];
  next[index] = value;
  return { ...values, [key]: next };
}

/** Split a stored page into template values + preserved legacy groups. */
function splitProduct(
  template: ProductSpecTemplate,
  groups: ProductSpecGroup[],
): GroupValues {
  const values: SpecValues = {};
  const legacy: ProductSpecGroup[] = [];
  for (const group of groups) {
    if (!matchTemplateGroup(template, group)) {
      legacy.push(group);
      continue;
    }
    const section = template.sections.find(
      (candidate) => candidate.title === group.title,
    );
    if (!section) {
      legacy.push(group);
      continue;
    }
    const byLabel = new Map(section.fields.map((f) => [f.label, f.key]));
    for (const row of group.rows) {
      const key = byLabel.get(row.label);
      if (key) {
        const draftKey = valueKey(section.key, key);
        values[draftKey] = [...(values[draftKey] ?? []), row.value];
      }
    }
  }
  return { values, legacy };
}

/** Compose only filled sections, then append the preserved legacy groups. */
function composeGroups(
  template: ProductSpecTemplate,
  values: SpecValues,
  legacy: ProductSpecGroup[],
): ProductSpecGroup[] {
  const groups: ProductSpecGroup[] = [];
  for (const section of template.sections) {
    // One row per value, in field order: a multi-value field (4G bands per
    // regional model) emits each line back as its own row.
    const rows = section.fields.flatMap((field) =>
      (values[valueKey(section.key, field.key)] ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => ({ label: field.label, value })),
    );
    if (rows.length > 0) groups.push({ title: section.title, rows });
  }
  return [...groups, ...legacy];
}

function TemplateFields({
  template,
  values,
  onChange,
}: {
  template: ProductSpecTemplate;
  values: SpecValues;
  onChange: (values: SpecValues) => void;
}) {
  return (
    <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
      {template.sections.map((section) => (
        <div
          key={section.key}
          className="space-y-3 rounded-md border border-border p-3"
        >
          <p className="type-body-sm font-medium text-foreground">
            {section.title}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.fields.map((field) => {
              const key = valueKey(section.key, field.key);
              const list = values[key] ?? [];
              const shown = list.length > 0 ? list : [""];

              if (!field.multi) {
                return (
                  <label key={field.key} className="grid gap-1">
                    <span className="type-meta text-muted-foreground">
                      {field.label}
                    </span>
                    <Input
                      value={shown[0]}
                      maxLength={500}
                      onChange={(event) =>
                        onChange(
                          list.length > 0
                            ? setValueAt(values, key, 0, event.target.value)
                            : { ...values, [key]: [event.target.value] },
                        )
                      }
                    />
                  </label>
                );
              }

              // A multi-value field (network bands): one input per value, a
              // remove control once there are two, and an add control below.
              return (
                <div key={field.key} className="grid gap-1 sm:col-span-2">
                  <span className="type-meta text-muted-foreground">
                    {field.label}
                  </span>
                  {shown.map((value, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={value}
                        maxLength={500}
                        aria-label={`${field.label} ${index + 1}`}
                        onChange={(event) =>
                          onChange(
                            list.length > 0
                              ? setValueAt(
                                  values,
                                  key,
                                  index,
                                  event.target.value,
                                )
                              : { ...values, [key]: [event.target.value] },
                          )
                        }
                      />
                      {shown.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label={`Remove ${field.label} ${index + 1}`}
                          onClick={() =>
                            onChange({
                              ...values,
                              [key]: shown.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...values, [key]: [...shown, ""] })
                    }
                    className="w-fit cursor-pointer type-meta text-[#00a0e9] hover:underline"
                  >
                    + Add value
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const emptyGroup = (): ProductSpecGroup => ({
  title: "",
  rows: [{ label: "", value: "" }],
});

/** Trim and validate the freeform editor; null means an incomplete row. */
function normalizeFreeformGroups(
  groups: ProductSpecGroup[],
): ProductSpecGroup[] | null {
  const normalized = groups.map((group) => ({
    title: group.title.trim(),
    rows: group.rows.map((row) => ({
      label: row.label.trim(),
      value: row.value.trim(),
    })),
  }));
  const valid =
    normalized.length > 0 &&
    normalized.every(
      (group) =>
        group.title.length > 0 &&
        group.rows.length > 0 &&
        group.rows.every((row) => row.label.length > 0 && row.value.length > 0),
    );
  return valid ? normalized : null;
}

/** The old freeform editor: any group, any row, staff decides the fields. */
function FreeformGroups({
  groups,
  onChange,
}: {
  groups: ProductSpecGroup[];
  onChange: (groups: ProductSpecGroup[]) => void;
}) {
  const patchGroup = (gi: number, patch: Partial<ProductSpecGroup>) =>
    onChange(
      groups.map((group, i) => (i === gi ? { ...group, ...patch } : group)),
    );

  const patchRow = (
    gi: number,
    ri: number,
    patch: Partial<ProductSpecGroup["rows"][number]>,
  ) =>
    onChange(
      groups.map((group, i) =>
        i === gi
          ? {
              ...group,
              rows: group.rows.map((row, j) =>
                j === ri ? { ...row, ...patch } : row,
              ),
            }
          : group,
      ),
    );

  return (
    <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
      {groups.map((group, gi) => (
        <div key={gi} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Group title"
              value={group.title}
              maxLength={120}
              placeholder="Group title (e.g. Engine)"
              onChange={(event) =>
                patchGroup(gi, { title: event.target.value })
              }
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Remove group"
              disabled={groups.length === 1}
              onClick={() => onChange(groups.filter((_, i) => i !== gi))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {group.rows.map((row, ri) => (
            <div key={ri} className="flex items-center gap-2">
              <Input
                aria-label="Spec label"
                value={row.label}
                maxLength={100}
                placeholder="Label"
                onChange={(event) =>
                  patchRow(gi, ri, { label: event.target.value })
                }
              />
              <Input
                aria-label="Spec value"
                value={row.value}
                maxLength={500}
                placeholder="Value"
                onChange={(event) =>
                  patchRow(gi, ri, { value: event.target.value })
                }
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Remove row"
                disabled={group.rows.length === 1}
                onClick={() =>
                  patchGroup(gi, {
                    rows: group.rows.filter((_, j) => j !== ri),
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              patchGroup(gi, {
                rows: [...group.rows, { label: "", value: "" }],
              })
            }
          >
            <Plus className="mr-1 size-3.5" />
            Add row
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...groups, emptyGroup()])}
      >
        <Plus className="mr-1 size-3.5" />
        Add group
      </Button>
    </div>
  );
}

function LegacyGroups({
  groups,
  onChange,
}: {
  groups: ProductSpecGroup[];
  onChange: (groups: ProductSpecGroup[]) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <p className="type-body-sm font-medium text-foreground">
        Additional details
      </p>
      <p className="type-meta text-muted-foreground">
        Sections saved before the family template. They are kept as-is.
      </p>
      {groups.map((group, index) => (
        <div key={`${group.title}-${index}`} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="type-body-sm font-medium">{group.title}</span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={`Remove ${group.title}`}
              onClick={() => onChange(groups.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {group.rows.map((row, rowIndex) => (
            <div
              key={`${row.label}-${rowIndex}`}
              className="flex gap-2 type-body-sm"
            >
              <span className="w-40 shrink-0 text-muted-foreground">
                {row.label}
              </span>
              <span className="text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PublishToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <div>
        <p className="type-body-sm font-medium">Published</p>
        <p className="type-meta text-muted-foreground">
          Draft pages are hidden from search and from the post form.
        </p>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function CreateProductForm({
  family,
  brands,
  models,
  template,
  usedModelIds,
  onSuccess,
  onCancel,
}: {
  family: ProductSpecFamily;
  brands: Brand[];
  models: Model[];
  template: ProductSpecTemplate;
  usedModelIds: Set<string>;
  onSuccess: (label: string) => void;
  onCancel: () => void;
}) {
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");
  const [isPublished, setIsPublished] = useState(true);
  const [imageUrl, setImageUrl] = useState("");
  const [values, setValues] = useState<SpecValues>({});
  const [groups, setGroups] = useState<ProductSpecGroup[]>([emptyGroup()]);
  const [saving, setSaving] = useState(false);

  const modelOptions = models.filter(
    (model) => model.brandId === brandId && !usedModelIds.has(model.modelId),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modelId) {
      toast.error("Choose a model first");
      return;
    }
    let specGroups: ProductSpecGroup[];
    if (template.mode === "freeform") {
      const normalized = normalizeFreeformGroups(groups);
      if (!normalized) {
        toast.error("Fill every group title, label and value");
        return;
      }
      specGroups = normalized;
    } else {
      specGroups = composeGroups(template, values, []);
      if (specGroups.length === 0) {
        toast.error("Fill at least one specification value");
        return;
      }
    }

    setSaving(true);
    const res = await createProduct({
      modelId,
      family,
      image: imageUrl,
      specGroups,
      isPublished,
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error ?? "Failed to create product spec");
      return;
    }
    const brand = brands.find((item) => item.brandId === brandId);
    const model = models.find((item) => item.modelId === modelId);
    onSuccess(`${brand?.name ?? ""} ${model?.name ?? ""}`.trim());
  };

  return (
    <form onSubmit={submit} className="space-y-4 py-2">
      <div className="grid gap-2">
        <label className="type-body-sm font-medium">Brand</label>
        <Select
          value={brandId}
          onValueChange={(value) => {
            setBrandId(value);
            setModelId("");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a brand" />
          </SelectTrigger>
          <SelectContent>
            {brands.map((brand) => (
              <SelectItem key={brand.brandId} value={brand.brandId}>
                {brand.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <label className="type-body-sm font-medium">Model</label>
        <Select value={modelId} onValueChange={setModelId} disabled={!brandId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((model) => (
              <SelectItem key={model.modelId} value={model.modelId}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="type-meta text-muted-foreground">
          Only models linked to this family appear here. Missing a model? Add it
          first under{" "}
          <Link
            href="/wanderer/dashboard/attributes/models"
            className="text-sky-600 hover:underline"
          >
            Attributes → Models
          </Link>
          .
        </p>
      </div>

      <PublishToggle value={isPublished} onChange={setIsPublished} />

      <div className="grid gap-2">
        <label className="type-body-sm font-medium">Product image</label>
        <ImageUpload
          scope="product"
          value={imageUrl}
          onChange={setImageUrl}
          label="Product image"
          previewClassName="h-40 w-64"
          imageFit="contain"
        />
        <p className="type-meta text-muted-foreground">
          Falls back to the model image when empty.
        </p>
      </div>

      <div className="space-y-2">
        <p className="type-body-sm font-medium">Specifications</p>
        {template.mode === "freeform" ? (
          <FreeformGroups groups={groups} onChange={setGroups} />
        ) : (
          <TemplateFields
            template={template}
            values={values}
            onChange={setValues}
          />
        )}
      </div>

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
          disabled={saving}
          className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditProductForm({
  product,
  template,
  onSuccess,
  onCancel,
}: {
  product: AdminProduct;
  template: ProductSpecTemplate;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const initial = useMemo(
    () => splitProduct(template, product.specGroups),
    [template, product],
  );
  const [values, setValues] = useState<SpecValues>(initial.values);
  const [legacy, setLegacy] = useState<ProductSpecGroup[]>(initial.legacy);
  const [groups, setGroups] = useState<ProductSpecGroup[]>(() =>
    product.specGroups.length > 0 ? product.specGroups : [emptyGroup()],
  );
  const [isPublished, setIsPublished] = useState(product.isPublished);
  const [imageUrl, setImageUrl] = useState(product.specImage ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let specGroups: ProductSpecGroup[];
    if (template.mode === "freeform") {
      const normalized = normalizeFreeformGroups(groups);
      if (!normalized) {
        toast.error("Fill every group title, label and value");
        return;
      }
      specGroups = normalized;
    } else {
      specGroups = composeGroups(template, values, legacy);
      if (specGroups.length === 0) {
        toast.error("Fill at least one specification value");
        return;
      }
    }

    setSaving(true);
    const res = await updateProduct(product.id, {
      specGroups,
      image: imageUrl,
      isPublished,
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error ?? "Failed to update product spec");
      return;
    }
    onSuccess();
  };

  return (
    <form onSubmit={submit} className="space-y-4 py-2">
      <div>
        <p className="type-meta text-muted-foreground">Product</p>
        <p className="type-body-sm font-medium">
          {product.brandName} {product.modelName}
        </p>
        <p className="type-meta text-muted-foreground">
          {product.brandSlug}/{product.modelSlug}
        </p>
      </div>

      <PublishToggle value={isPublished} onChange={setIsPublished} />

      <div className="grid gap-2">
        <label className="type-body-sm font-medium">Product image</label>
        <ImageUpload
          scope="product"
          value={imageUrl}
          onChange={setImageUrl}
          label="Product image"
          previewClassName="h-40 w-64"
          imageFit="contain"
        />
        <p className="type-meta text-muted-foreground">
          Falls back to the model image when empty.
        </p>
      </div>

      {template.mode === "freeform" ? (
        <FreeformGroups groups={groups} onChange={setGroups} />
      ) : (
        <>
          <TemplateFields
            template={template}
            values={values}
            onChange={setValues}
          />
          <LegacyGroups groups={legacy} onChange={setLegacy} />
        </>
      )}

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
          disabled={saving}
          className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteProductForm({
  product,
  onSuccess,
  onCancel,
}: {
  product: AdminProduct;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDeleting(true);
    const res = await deleteProduct({ productId: product.id });
    setDeleting(false);
    if (!res.success) {
      toast.error(res.error ?? "Failed to delete product spec");
      return;
    }
    onSuccess();
  };

  return (
    <form onSubmit={submit} className="space-y-4 py-2">
      <p className="type-body-sm text-foreground">
        {product.brandName} {product.modelName}
      </p>
      <p className="type-body-sm text-muted-foreground">
        This removes the public spec page. Listings that point at it lose their
        &quot;View full specs&quot; link.
      </p>
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
          disabled={deleting}
          className="h-9 rounded-sm bg-red-500 text-white hover:bg-red-600 hover:text-white cursor-pointer"
        >
          {deleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProductSpecsPage({
  family,
  label,
  subcategorySlug,
}: {
  family: ProductSpecFamily;
  label: string;
  subcategorySlug: string;
}) {
  const queryClient = useQueryClient();
  const { data: productList = [], isLoading } = useQuery({
    queryKey: ["admin", "product-specs", family],
    queryFn: () => getAdminProducts(family),
  });
  const { data: template, isPending: templateLoading } = useQuery({
    queryKey: ["admin", "product-spec-template", family],
    queryFn: () => getProductTemplate(family),
  });
  const { data: brandList = [] } = useQuery({
    queryKey: ["admin", "brands"],
    queryFn: getAdminBrands,
  });
  const { data: modelList = [] } = useQuery({
    queryKey: ["admin", "models"],
    queryFn: getAdminModels,
  });
  const { data: subcategoryList = [] } = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });

  const refreshProducts = () =>
    queryClient.invalidateQueries({
      queryKey: ["admin", "product-specs", family],
    });

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<AdminProduct | null>(
    null,
  );

  const familySubcategoryId = subcategoryList.find(
    (subcategory) => subcategory.slug === subcategorySlug,
  )?.subId;

  const eligibleModels = useMemo(
    () =>
      familySubcategoryId
        ? modelList.filter((model) =>
            model.subcategories.includes(familySubcategoryId),
          )
        : [],
    [modelList, familySubcategoryId],
  );

  // Only brands of this family's listing subcategory — never every catalogue
  // brand (Apple, Samsung… have no place in a Cars picker).
  const familyBrands = useMemo(
    () =>
      familySubcategoryId
        ? brandList.filter((brand) =>
            brand.subcategories.includes(familySubcategoryId),
          )
        : [],
    [brandList, familySubcategoryId],
  );

  const usedModelIds = useMemo(
    () => new Set(productList.map((product) => product.modelId)),
    [productList],
  );

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return productList.filter((product) => {
      if (statusFilter === "published" && !product.isPublished) return false;
      if (statusFilter === "draft" && product.isPublished) return false;
      if (!query) return true;
      return [
        product.brandName,
        product.brandSlug,
        product.modelName,
        product.modelSlug,
        ...product.specGroups.map((group) => group.title),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [productList, searchQuery, statusFilter]);

  const openEditDialog = (product: AdminProduct) => {
    setSelectedProduct(product);
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (product: AdminProduct) => {
    setSelectedProduct(product);
    setIsDeleteDialogOpen(true);
  };

  const specCount = (product: AdminProduct) =>
    product.specGroups.reduce((total, group) => total + group.rows.length, 0);

  const columns: AdminColumn<AdminProduct>[] = [
    {
      key: "product",
      header: "Product",
      sortValue: (product) => `${product.brandName} ${product.modelName}`,
      cell: (product) => (
        <PrimaryCell
          image={product.image}
          alt={product.modelName}
          title={`${product.brandName} ${product.modelName}`}
          subtitle={`${product.brandSlug}/${product.modelSlug}`}
          imageClassName="object-contain p-0.5"
        />
      ),
    },
    {
      key: "specs",
      header: "Specs",
      align: "right",
      sortValue: specCount,
      cell: (product) => (
        <span className="tabular-nums">{specCount(product)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (product) => (product.isPublished ? 1 : 0),
      cell: (product) => (
        <span
          className={cn(
            "inline-flex items-center rounded px-2 py-0.5 type-body-sm",
            product.isPublished
              ? "bg-emerald-100 text-emerald-700"
              : "bg-muted text-muted-foreground",
          )}
        >
          {product.isPublished ? "Published" : "Draft"}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      sortValue: (product) => product.updatedAt,
      cell: (product) => <DateCell value={product.updatedAt} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (product) => (
        <RowActions
          id={product.id}
          actions={[
            {
              label: "Edit",
              icon: <Pencil className="mr-2 size-4" />,
              onSelect: () => openEditDialog(product),
            },
            {
              label: "Delete",
              icon: <Trash2 className="mr-2 size-4" />,
              tone: "danger",
              onSelect: () => openDeleteDialog(product),
            },
          ]}
        />
      ),
    },
  ];

  const templateUnavailable = !templateLoading && !template;

  return (
    <>
      <AdminPage
        title={`Product Specifications — ${label}`}
        description={
          template?.mode === "freeform"
            ? `Freeform ${label.toLowerCase()} specification pages: add the sections and fields each vehicle needs. Only published pages are offered on the post form.`
            : `Fixed ${label.toLowerCase()} specification pages written by staff. Only published pages are offered on the post form.`
        }
        action={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button
                disabled={!template}
                className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
              >
                <Plus className="mr-2 size-4" />
                Add Specification
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add {label} Specification</DialogTitle>
                <DialogDescription>
                  Pick a brand and model, then fill its template.
                </DialogDescription>
              </DialogHeader>
              {isAddDialogOpen && template ? (
                <CreateProductForm
                  family={family}
                  brands={familyBrands}
                  models={eligibleModels}
                  template={template}
                  usedModelIds={usedModelIds}
                  onSuccess={(name) => {
                    refreshProducts();
                    setIsAddDialogOpen(false);
                    toast.success(`Specification "${name}" created!`);
                  }}
                  onCancel={() => setIsAddDialogOpen(false)}
                />
              ) : (
                <p className="type-body-sm text-muted-foreground">
                  Template unavailable. Reload the page or contact support.
                </p>
              )}
            </DialogContent>
          </Dialog>
        }
        toolbar={
          <>
            <AdminSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search brand, model, section..."
            />
            <AdminFilter
              value={statusFilter}
              onChange={setStatusFilter}
              allLabel="All statuses"
              options={[
                { value: "published", label: "Published" },
                { value: "draft", label: "Draft" },
              ]}
            />
          </>
        }
      >
        {templateUnavailable && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 type-body-sm text-amber-800">
            The template for this family could not be loaded. Spec pages stay
            listed but cannot be created or edited until it loads.
          </p>
        )}
        <AdminTable
          columns={columns}
          rows={filteredProducts}
          rowKey={(product) => product.id}
          isLoading={isLoading || templateLoading}
          pageSize={20}
          resetKey={`${searchQuery}:${statusFilter}`}
          emptyTitle={`No ${label.toLowerCase()} specification yet`}
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Specification</DialogTitle>
            <DialogDescription>
              The model is fixed; fill the template and publish state.
            </DialogDescription>
          </DialogHeader>
          {isEditDialogOpen && selectedProduct && template ? (
            <EditProductForm
              key={selectedProduct.id}
              product={selectedProduct}
              template={template}
              onSuccess={() => {
                refreshProducts();
                setSelectedProduct(null);
                setIsEditDialogOpen(false);
                toast.success("Specification updated!");
              }}
              onCancel={() => setIsEditDialogOpen(false)}
            />
          ) : (
            <p className="type-body-sm text-muted-foreground">
              Template unavailable. Reload the page or contact support.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Specification</DialogTitle>
            <DialogDescription>
              This removes the public spec page.
            </DialogDescription>
          </DialogHeader>
          {isDeleteDialogOpen && selectedProduct ? (
            <DeleteProductForm
              key={selectedProduct.id}
              product={selectedProduct}
              onSuccess={() => {
                refreshProducts();
                setSelectedProduct(null);
                setIsDeleteDialogOpen(false);
                toast.success("Specification deleted!");
              }}
              onCancel={() => setIsDeleteDialogOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
