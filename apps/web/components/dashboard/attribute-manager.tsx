"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ImageUpload } from "@/components/dashboard/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import { getAdminCategories } from "@/actions/admin-categories";
import { getAdminSubcategories } from "@/actions/admin-subcategories";
import {
  getAdminAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  type AdminAttribute,
} from "@/actions/admin-attributes";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminSearch,
  AdminTable,
  ChipList,
  DateCell,
  EntityChip,
  PrimaryCell,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";

interface FormState {
  name: string;
  nameKm: string;
  slug: string;
  image: string;
  categoryId: string;
  subcategories: string[];
}

const EMPTY: FormState = {
  name: "",
  nameKm: "",
  slug: "",
  image: "",
  categoryId: "",
  subcategories: [],
};

/**
 * Generic admin CRUD for any attribute-option `type` (body types, accessories,
 * job types, …), backed by `/admin/attributes/:type`. It renders on the shared
 * admin table kit, so an image-led option (Body Types) leads with its icon
 * instead of a raw UUID row.
 */
export function AttributeManager({
  type,
  title,
  hasImage = false,
  readOnly = false,
}: {
  type: string;
  title: string;
  hasImage?: boolean;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["admin", "attributes", type],
    queryFn: () => getAdminAttributes(type),
  });
  const { data: allCategories = [] } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: getAdminCategories,
  });
  const { data: allSubcategories = [] } = useQuery({
    queryKey: ["admin", "subcategories"],
    queryFn: getAdminSubcategories,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "attributes", type] });

  const [searchQuery, setSearchQuery] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<AdminAttribute | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const availableSubcategories = allSubcategories.filter(
    (s) => s.categoryId === form.categoryId,
  );
  const toggleSub = (subId: string) =>
    setForm((prev) => ({
      ...prev,
      subcategories: prev.subcategories.includes(subId)
        ? prev.subcategories.filter((id) => id !== subId)
        : [...prev.subcategories, subId],
    }));

  const categoryById = useMemo(
    () => new Map(allCategories.map((category) => [category.cateId, category])),
    [allCategories],
  );
  const subcategoryById = useMemo(
    () => new Map(allSubcategories.map((sub) => [sub.subId, sub])),
    [allSubcategories],
  );

  const subcategoryNames = (item: AdminAttribute) =>
    item.subcategories
      .map((id) => subcategoryById.get(id)?.name)
      .filter((name): name is string => Boolean(name));

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const categoryName = categoryById.get(item.categoryId)?.name ?? "";
      return [
        item.name,
        item.nameKm ?? "",
        item.slug,
        categoryName,
        ...subcategoryNames(item),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subcategoryNames is a pure lookup over the map below
  }, [items, searchQuery, categoryById, subcategoryById]);

  const submit = async (id?: string) => {
    setSaving(true);
    const input = {
      name: form.name,
      nameKm: form.nameKm,
      slug: form.slug,
      image: hasImage ? form.image : undefined,
      categoryId: form.categoryId,
      subcategoryIds: form.subcategories,
    };
    const res = id
      ? await updateAttribute(type, id, input)
      : await createAttribute(type, input);
    setSaving(false);
    if (res.success) {
      refresh();
      setIsAddOpen(false);
      setIsEditOpen(false);
      toast.success(`${title} ${id ? "updated" : "created"}`);
    } else {
      toast.error(res.error ?? "Save failed");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const res = await deleteAttribute(type, selected.id);
    if (res.success) {
      refresh();
      toast.success(`"${selected.name}" deleted`);
    } else {
      toast.error(res.error ?? "Delete failed");
    }
    setSelected(null);
    setIsDeleteOpen(false);
  };

  const openAdd = () => {
    setForm(EMPTY);
    setIsAddOpen(true);
  };
  const openEdit = (item: AdminAttribute) => {
    setSelected(item);
    setForm({
      name: item.name,
      nameKm: item.nameKm ?? "",
      slug: item.slug,
      image: item.image ?? "",
      categoryId: item.categoryId,
      subcategories: item.subcategories,
    });
    setIsEditOpen(true);
  };

  const fields = (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label>Name</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label>Khmer Name</Label>
        <Input
          value={form.nameKm}
          onChange={(e) => setForm({ ...form, nameKm: e.target.value })}
          placeholder="ឈ្មោះជាភាសាខ្មែរ"
        />
      </div>
      <div className="grid gap-2">
        <Label>Slug</Label>
        <Input
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
        />
      </div>
      {hasImage && (
        <div className="grid gap-2">
          <Label>Image</Label>
          <ImageUpload
            scope="attribute"
            value={form.image}
            onChange={(url) => setForm({ ...form, image: url })}
            label="Image"
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label>Category</Label>
        <Select
          value={form.categoryId}
          onValueChange={(value) =>
            setForm({ ...form, categoryId: value, subcategories: [] })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {allCategories.map((cat) => (
                <SelectItem key={cat.cateId} value={cat.cateId}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Subcategories</Label>
        {!form.categoryId ? (
          <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
            Choose a category first
          </p>
        ) : availableSubcategories.length === 0 ? (
          <p className="type-body-sm text-muted-foreground border rounded-md px-3 py-2">
            No subcategories available
          </p>
        ) : (
          <div className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
            {availableSubcategories.map((sub) => (
              <label
                key={sub.subId}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer type-body-sm"
              >
                <Checkbox
                  checked={form.subcategories.includes(sub.subId)}
                  onCheckedChange={() => toggleSub(sub.subId)}
                />
                {sub.name}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const columns = useMemo<AdminColumn<AdminAttribute>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        sortValue: (item) => item.name,
        cell: (item) => (
          <PrimaryCell
            image={hasImage ? item.image : undefined}
            alt={item.name}
            title={item.name}
            subtitle={item.nameKm || undefined}
            imageClassName="object-contain p-0.5"
          />
        ),
      },
      {
        key: "slug",
        header: "Slug",
        sortValue: (item) => item.slug,
        cell: (item) => (
          <span className="text-muted-foreground">{item.slug}</span>
        ),
      },
      {
        key: "category",
        header: "Category",
        sortValue: (item) => categoryById.get(item.categoryId)?.name ?? "",
        cell: (item) => (
          <EntityChip tone="category">
            {categoryById.get(item.categoryId)?.name ?? "—"}
          </EntityChip>
        ),
      },
      {
        key: "subcategories",
        header: "Sub Categories",
        sortValue: (item) => subcategoryNames(item).join(", "),
        cell: (item) => <ChipList items={subcategoryNames(item)} max={3} />,
      },
      {
        key: "updated",
        header: "Updated",
        sortValue: (item) => item.updatedAt,
        cell: (item) => <DateCell value={item.updatedAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (item) =>
          readOnly ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <RowActions
              id={item.id}
              actions={[
                {
                  label: "Edit",
                  icon: <Pencil className="mr-2 size-4" />,
                  tone: "warning",
                  onSelect: () => openEdit(item),
                },
                {
                  label: "Delete",
                  icon: <Trash2 className="mr-2 size-4" />,
                  tone: "danger",
                  onSelect: () => {
                    setSelected(item);
                    setIsDeleteOpen(true);
                  },
                },
              ]}
            />
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit only sets state
    [categoryById, subcategoryById],
  );

  return (
    <>
      <AdminPage
        title={title}
        description={
          readOnly
            ? `Years are generated automatically (1980 – ${new Date().getFullYear() + 1}) and cannot be edited.`
            : `Manage ${title} here.`
        }
        action={
          readOnly ? undefined : (
            <Button
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
              onClick={openAdd}
            >
              <Plus className="mr-2 size-4" />
              Add {title}
            </Button>
          )
        }
        toolbar={
          <AdminSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search name, Khmer name, slug, category..."
          />
        }
      >
        <AdminTable
          columns={columns}
          rows={filtered}
          rowKey={(item) => item.id}
          isLoading={isLoading}
          pageSize={20}
          resetKey={searchQuery}
          emptyTitle={`No ${title} found`}
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>

      {/* Add / Edit dialogs share the same field set */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {title}</DialogTitle>
            <DialogDescription>Create a new entry.</DialogDescription>
          </DialogHeader>
          {fields}
          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 rounded-sm cursor-pointer"
              onClick={() => setIsAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
              onClick={() => submit()}
              disabled={saving}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {title}</DialogTitle>
            <DialogDescription>Update the details.</DialogDescription>
          </DialogHeader>
          {fields}
          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 rounded-sm cursor-pointer"
              onClick={() => setIsEditOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
              onClick={() => submit(selected?.id)}
              disabled={saving}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {title}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selected?.name}&quot;? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 rounded-sm cursor-pointer"
              onClick={() => setIsDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="h-9 bg-red-500 text-white rounded-sm hover:bg-red-600 hover:text-white cursor-pointer"
              onClick={handleDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
