"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import DbImage, { NoImageCell } from "@/components/common/DbImage";
import { ImageUpload } from "@/components/dashboard/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import {
  createAdvertisement,
  deleteAdvertisement,
  getAdvertisements,
  updateAdvertisement,
} from "@/actions/advertisements";
import {
  ADVERTISEMENT_PLACEMENTS,
  type AdminAdvertisement,
  type AdvertisementPlacement,
} from "@/lib/advertisements";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminSearch,
  AdminTable,
  EntityChip,
  RowActions,
  type AdminColumn,
} from "@/components/dashboard/admin-table";

interface FormState {
  placement: AdvertisementPlacement;
  imageUrl: string;
  imagePath: string;
  linkUrl: string;
  altText: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  placement: "home",
  imageUrl: "",
  imagePath: "",
  linkUrl: "",
  altText: "",
  sortOrder: "0",
  isActive: true,
};

const placementLabel = (value: string) =>
  ADVERTISEMENT_PLACEMENTS.find((p) => p.value === value)?.label ?? value;

/** The 4:1 banner thumbnail that leads the row. */
function BannerThumb({ banner }: { banner: AdminAdvertisement }) {
  return (
    <div className="relative h-9 w-36 shrink-0 overflow-hidden rounded border border-border bg-muted">
      <DbImage
        src={banner.imageUrl}
        alt={banner.altText || "Banner"}
        fill
        className="object-cover"
        fallback={<NoImageCell />}
      />
    </div>
  );
}

export default function AdvertisementsPage() {
  const queryClient = useQueryClient();
  const { data: banners = [], isLoading } = useQuery({
    queryKey: ["admin", "advertisements"],
    queryFn: getAdvertisements,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAdvertisement | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<AdminAdvertisement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (banner: AdminAdvertisement) => {
    setEditing(banner);
    setForm({
      placement: banner.placement,
      imageUrl: banner.imageUrl,
      imagePath: banner.imagePath,
      linkUrl: banner.linkUrl ?? "",
      altText: banner.altText,
      sortOrder: String(banner.sortOrder),
      isActive: banner.isActive,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.imagePath) {
      toast.error("Upload a banner image first");
      return;
    }
    setSaving(true);
    const payload = {
      placement: form.placement,
      imagePath: form.imagePath,
      linkUrl: form.linkUrl.trim(),
      altText: form.altText.trim(),
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive,
    };
    const res = editing
      ? await updateAdvertisement(editing.id, payload)
      : await createAdvertisement(payload);
    setSaving(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(editing ? "Banner updated" : "Banner added");
    await queryClient.invalidateQueries({
      queryKey: ["admin", "advertisements"],
    });
    setFormOpen(false);
  };

  const toggleActive = async (
    banner: AdminAdvertisement,
    isActive: boolean,
  ) => {
    const res = await updateAdvertisement(banner.id, { isActive });
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: ["admin", "advertisements"],
    });
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const res = await deleteAdvertisement(toDelete.id);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Banner deleted");
    setToDelete(null);
    await queryClient.invalidateQueries({
      queryKey: ["admin", "advertisements"],
    });
  };

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return banners;
    return banners.filter((banner) =>
      [banner.altText, placementLabel(banner.placement), banner.linkUrl ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [banners, searchQuery]);

  const columns = useMemo<AdminColumn<AdminAdvertisement>[]>(
    () => [
      {
        key: "banner",
        header: "Banner",
        sortValue: (banner) => banner.altText,
        cell: (banner) => (
          <div className="flex items-center gap-3">
            <BannerThumb banner={banner} />
            <div className="min-w-0">
              <div className="max-w-[220px] truncate font-medium">
                {banner.altText || "Banner"}
              </div>
              <div className="type-meta text-muted-foreground">
                {banner.isActive ? "Live" : "Hidden"}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: "placement",
        header: "Placement",
        sortValue: (banner) => placementLabel(banner.placement),
        cell: (banner) => (
          <EntityChip tone="category">
            {placementLabel(banner.placement)}
          </EntityChip>
        ),
      },
      {
        key: "link",
        header: "Link",
        sortValue: (banner) => banner.linkUrl ?? "",
        cell: (banner) => (
          <span className="block max-w-[240px] truncate type-meta text-muted-foreground">
            {banner.linkUrl ?? "—"}
          </span>
        ),
      },
      {
        key: "order",
        header: "Order",
        align: "center",
        sortValue: (banner) => banner.sortOrder,
        cell: (banner) => <span>{banner.sortOrder}</span>,
      },
      {
        key: "active",
        header: "Active",
        align: "center",
        sortValue: (banner) => (banner.isActive ? 1 : 0),
        cell: (banner) => (
          <Switch
            checked={banner.isActive}
            onCheckedChange={(checked) => void toggleActive(banner, checked)}
            className="data-checked:bg-[#00a0e9]"
          />
        ),
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (banner) => (
          <RowActions
            id={banner.id}
            actions={[
              {
                label: "Edit",
                icon: <Pencil className="mr-2 size-4" />,
                tone: "warning",
                onSelect: () => openEdit(banner),
              },
              {
                label: "Delete",
                icon: <Trash2 className="mr-2 size-4" />,
                tone: "danger",
                onSelect: () => setToDelete(banner),
              },
            ]}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit/toggleActive only call stable setters + the actions
    [],
  );

  return (
    <>
      <AdminPage
        title="Advertisements"
        description="Banners shown on the storefront. A slot showing more than one banner rotates them in order."
        action={
          <Button
            className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
            onClick={openCreate}
          >
            <Plus className="mr-2 size-4" />
            Add banner
          </Button>
        }
        toolbar={
          <AdminSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search alt text, placement, link..."
          />
        }
      >
        <AdminTable
          columns={columns}
          rows={filtered}
          rowKey={(banner) => banner.id}
          isLoading={isLoading}
          pageSize={20}
          resetKey={searchQuery}
          emptyTitle="No banners yet"
          emptyHint="Storefront slots stay empty until one is added."
        />
      </AdminPage>

      {/* Add / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit banner" : "Add banner"}</DialogTitle>
            <DialogDescription>
              Storefront banners are 4:1 — 1200 × 300 px renders crisply at
              every slot.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Placement</Label>
              <Select
                value={form.placement}
                onValueChange={(value) =>
                  setForm((f) => ({
                    ...f,
                    placement: value as AdvertisementPlacement,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADVERTISEMENT_PLACEMENTS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Image</Label>
              <ImageUpload
                scope="advertisement"
                value={form.imageUrl}
                onChange={(url) =>
                  setForm((f) => ({
                    ...f,
                    imageUrl: url,
                    imagePath: url ? f.imagePath : "",
                  }))
                }
                onUpload={({ path }) =>
                  setForm((f) => ({
                    ...f,
                    imageUrl: f.imageUrl,
                    imagePath: path,
                  }))
                }
                label="Banner"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="banner-link">Link (optional)</Label>
              <Input
                id="banner-link"
                placeholder="https://… or /all-ads"
                value={form.linkUrl}
                maxLength={2048}
                onChange={(e) =>
                  setForm((f) => ({ ...f, linkUrl: e.target.value }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="banner-alt">Alt text</Label>
              <Input
                id="banner-alt"
                placeholder="Shown when the image cannot load, read by screen readers"
                value={form.altText}
                maxLength={200}
                onChange={(e) =>
                  setForm((f) => ({ ...f, altText: e.target.value }))
                }
              />
            </div>

            <div className="flex items-end gap-4">
              <div className="grid gap-2">
                <Label htmlFor="banner-order">Order</Label>
                <Input
                  id="banner-order"
                  type="number"
                  min={0}
                  max={9999}
                  className="w-28"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch
                  id="banner-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, isActive: checked }))
                  }
                  className="data-checked:bg-[#00a0e9]"
                />
                <Label htmlFor="banner-active">Active</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving}
              className="h-9 rounded-sm bg-sky-500 text-white hover:bg-sky-600 hover:text-white cursor-pointer"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Add banner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this banner?</DialogTitle>
            <DialogDescription>
              The banner and its stored image are removed. Storefront slots
              showing nothing will collapse.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
