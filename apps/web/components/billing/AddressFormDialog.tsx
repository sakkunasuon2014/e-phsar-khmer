"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { getLocationProvinces } from "@/actions/listings";
import LocationPicker, {
  EMPTY_PLACE,
  type PlaceSelection,
} from "@/components/post/LocationPicker";
import LocationMapPicker from "@/components/post/LocationMapPicker";
import type { MapCoords } from "@/components/post/location-map.constants";
import type { BackendPlace } from "@/lib/api/categories";
import {
  createBillingAddress,
  updateBillingAddress,
  type BillingAddress,
  type BillingAddressCategory,
} from "@/actions/billing-addresses";

const CATEGORIES: { value: BillingAddressCategory; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "work", label: "Work" },
  { value: "other", label: "Other" },
];

/**
 * Add / edit one billing address. `editing` null means a new row.
 *
 * The form body only exists while the dialog is open and is keyed by the row
 * being edited, so every open starts from that row's values without an effect
 * writing state back into the component.
 */
export default function AddressFormDialog({
  open,
  onOpenChange,
  editing,
  defaultName,
  defaultPhone,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: BillingAddress | null;
  defaultName: string;
  defaultPhone: string;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open && (
          <AddressForm
            key={editing?.id ?? "new"}
            editing={editing}
            defaultName={defaultName}
            defaultPhone={defaultPhone}
            onSaved={onSaved}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddressForm({
  editing,
  defaultName,
  defaultPhone,
  onSaved,
  onClose,
}: {
  editing: BillingAddress | null;
  defaultName: string;
  defaultPhone: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<BillingAddressCategory>(
    editing?.category ?? "home",
  );
  const [saveAs, setSaveAs] = useState(
    editing?.category === "other" ? editing.label : "",
  );
  const [name, setName] = useState(editing?.name ?? defaultName);
  const [company, setCompany] = useState(editing?.company ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? defaultPhone);
  const [address, setAddress] = useState(editing?.address ?? "");
  const [taxId, setTaxId] = useState(editing?.taxId ?? "");
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);
  const [place, setPlace] = useState<PlaceSelection>(EMPTY_PLACE);
  const [placeTouched, setPlaceTouched] = useState(false);
  const [coords, setCoords] = useState<MapCoords | null>(
    editing?.latitude && editing?.longitude
      ? { lat: Number(editing.latitude), lng: Number(editing.longitude) }
      : null,
  );
  const [provinces, setProvinces] = useState<BackendPlace[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Districts and communes are only fetched by the picker when the user drills
  // in, so an edit seeds just the province it can resolve here.
  useEffect(() => {
    let alive = true;
    getLocationProvinces()
      .then((list) => {
        if (!alive) return;
        setProvinces(list);
        if (editing?.provinceId) {
          const found = list.find((item) => item.id === editing.provinceId);
          if (found) {
            setPlace({ province: found, district: null, commune: null });
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [editing]);

  const label =
    category === "other"
      ? saveAs.trim()
      : category === "home"
        ? "Home"
        : "Work";

  async function submit() {
    const next: Record<string, string> = {};
    if (!label) next.label = "Give this address a name";
    if (!name.trim()) next.name = "Name is required";
    if (phone.trim().length < 5) next.phone = "Phone number is required";
    if (!address.trim()) next.address = "Address is required";
    if (!placeTouched && !place.province && !editing?.provinceId) {
      next.place = "Choose a location";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    // Only a cascade the user actually drove overwrites the stored geography.
    const geography = placeTouched
      ? {
          provinceId: place.province?.id ?? undefined,
          districtId: place.district?.id ?? undefined,
          communeId: place.commune?.id ?? undefined,
        }
      : editing
        ? {
            provinceId: editing.provinceId ?? undefined,
            districtId: editing.districtId ?? undefined,
            communeId: editing.communeId ?? undefined,
          }
        : {
            provinceId: place.province?.id ?? undefined,
            districtId: place.district?.id ?? undefined,
            communeId: place.commune?.id ?? undefined,
          };

    const payload = {
      label,
      category,
      name: name.trim(),
      company: company.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim(),
      address: address.trim(),
      taxId: taxId.trim() || undefined,
      isDefault,
      latitude: coords?.lat,
      longitude: coords?.lng,
      ...geography,
    };

    setSaving(true);
    const result = editing
      ? await updateBillingAddress(editing.id, payload)
      : await createBillingAddress(payload);
    setSaving(false);

    if (!result.success) {
      toast.error(result.error ?? "Could not save the address");
      return;
    }
    toast.success(editing ? "Address updated" : "Address saved");
    onSaved();
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Address" : "Add Address"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <Field>
          <FieldLabel>
            Name <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name}</p>
          )}
        </Field>

        <Field>
          <FieldLabel>Company</FieldLabel>
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
          />
        </Field>

        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
        </Field>

        <Field>
          <FieldLabel>
            Phone Number <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="096 376 6181"
          />
          {errors.phone && (
            <p className="text-xs text-destructive">{errors.phone}</p>
          )}
        </Field>

        <div>
          <LocationPicker
            provinces={provinces}
            value={place}
            onChange={(next) => {
              setPlace(next);
              setPlaceTouched(true);
            }}
            required
            error={errors.place}
          />
        </div>

        <Field>
          <FieldLabel>
            Address <span className="text-destructive">*</span>
          </FieldLabel>
          <Textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={3}
            placeholder="Enter the address (e.g., House No. 225, Serey Vuth Street, Phnom Penh)"
          />
          {errors.address && (
            <p className="text-xs text-destructive">{errors.address}</p>
          )}
        </Field>

        <div>
          <LocationMapPicker value={coords} onChange={setCoords} />
        </div>

        <Field>
          <FieldLabel>Tax ID</FieldLabel>
          <Input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="Tax ID"
          />
        </Field>

        <Field>
          <FieldLabel>
            Category <span className="text-destructive">*</span>
          </FieldLabel>
          <div className="flex gap-2">
            {CATEGORIES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setCategory(item.value)}
                className={`flex-1 rounded-sm border py-2 text-sm transition-colors ${
                  category === item.value
                    ? "border-sky-400 bg-sky-50 text-sky-600 dark:bg-sky-500/10"
                    : "hover:bg-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Field>

        {category === "other" && (
          <Field>
            <FieldLabel>
              Save As <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              value={saveAs}
              onChange={(e) => setSaveAs(e.target.value)}
              placeholder="Save As"
            />
            {errors.label && (
              <p className="text-xs text-destructive">{errors.label}</p>
            )}
          </Field>
        )}

        <div className="flex items-center justify-between rounded-sm border p-3">
          <span className="text-sm">Set as default</span>
          <Switch
            checked={isDefault}
            onCheckedChange={setIsDefault}
            className="data-[checked]:bg-[#00a0e9]"
          />
        </div>

        <div className="flex gap-2 pb-1">
          <Button
            variant="outline"
            className="h-10 w-1/2 rounded-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="h-10 w-1/2 rounded-sm bg-orange-500 text-white hover:bg-orange-600"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Submit"}
          </Button>
        </div>
      </div>
    </>
  );
}
