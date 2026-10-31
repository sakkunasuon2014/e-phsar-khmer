"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldSet,
  FieldGroup,
  FieldContent,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "@/i18n/routing";
import { toast } from "sonner";
import SettingSidebar from "./SettingSidebar";
import { DateOfBirthPicker } from "./DateOfBirthPicker";
import LocationPicker, {
  placeLabel,
  type PlaceSelection,
} from "@/components/post/LocationPicker";
import LocationMapPicker from "@/components/post/LocationMapPicker";
import type { MapCoords } from "@/components/post/location-map.constants";
import {
  addMyPhone,
  removeMyPhone,
  updateMyPhone,
  updateMyProfile,
  type MyPhoneRow,
} from "@/actions/settings";
import { formatPhoneLocal, normalizePhone } from "@/lib/phone";
import type { BackendPlace } from "@/lib/api/categories";
import type { SettingsUser } from "@/lib/auth/current-user";

/** Local calendar date → `YYYY-MM-DD` (never `toISOString`, which shifts days). */
function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parse a stored `YYYY-MM-DD` into a local Date (midnight local time). */
function parseIsoDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * One contact-phone row. `id` is null until the row is first stored; `initial`
 * is the E.164 value the row had at load time, so a save can tell an edit from
 * a no-op. These numbers are contact info — deliberately unrelated to the
 * account's active (login) phone.
 */
interface PhoneRow {
  id: string | null;
  phone: string;
  initial: string | null;
}

/** The contact block caps at 3 numbers. */
const MAX_PHONES = 3;

const emptyPhoneRow = (): PhoneRow => ({ id: null, phone: "", initial: null });

function initialPhoneRows(phones: MyPhoneRow[]): PhoneRow[] {
  const rows = [...phones]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((p) => ({
      id: p.id,
      phone: formatPhoneLocal(p.phone),
      initial: p.phone,
    }));
  return rows.length > 0 ? rows : [emptyPhoneRow()];
}

export default function EditProfile({
  me,
  provinces,
  savedPlace,
  phones,
}: {
  me: SettingsUser;
  provinces: BackendPlace[];
  savedPlace: PlaceSelection;
  phones: MyPhoneRow[];
}) {
  const t = useTranslations("Settings.profile");
  const router = useRouter();

  const [firstName, setFirstName] = React.useState(me.firstName ?? "");
  const [lastName, setLastName] = React.useState(me.lastName ?? "");
  const [gender, setGender] = React.useState<"male" | "female" | null>(
    me.gender,
  );
  const [dateOfBirth, setDateOfBirth] = React.useState<Date | undefined>(() =>
    parseIsoDate(me.dateOfBirth),
  );
  const [email, setEmail] = React.useState(me.email ?? "");
  const [company, setCompany] = React.useState(me.company ?? "");
  const [place, setPlace] = React.useState<PlaceSelection>(savedPlace);
  const [address, setAddress] = React.useState(me.address ?? "");
  const [coords, setCoords] = React.useState<MapCoords | null>(() => {
    if (me.latitude === null || me.longitude === null) return null;
    const lat = Number(me.latitude);
    const lng = Number(me.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  });
  // Opt-in, not sticky: the switch starts off so saving the profile never
  // rewrites ad contacts unless the user explicitly asks for it.
  const [updateAdsContact, setUpdateAdsContact] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Inline validation for the trio "Update this contact to your ads" turns
  // into a requirement. Each entry clears as soon as its field is fixed.
  const [contactErrors, setContactErrors] = React.useState<{
    phone?: string;
    location?: string;
    address?: string;
  }>({});

  // Contact numbers only. The active/login phone is managed on
  // /settings/change-phone and must not move from this form.
  const [phoneRows, setPhoneRows] = React.useState<PhoneRow[]>(() =>
    initialPhoneRows(phones),
  );
  const [removedPhoneIds, setRemovedPhoneIds] = React.useState<string[]>([]);

  const canSubmit = firstName.trim().length > 0 && !saving;

  const clearContactError = (key: "phone" | "location" | "address") => {
    setContactErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addPhoneRow = () => {
    if (phoneRows.length >= MAX_PHONES) return;
    setPhoneRows((rows) => [...rows, emptyPhoneRow()]);
  };

  const removePhoneRow = (index: number) => {
    const row = phoneRows[index];
    if (!row) return;
    if (row.id) setRemovedPhoneIds((ids) => [...ids, row.id as string]);
    const next = phoneRows.filter((_, i) => i !== index);
    const remaining = next.length > 0 ? next : [emptyPhoneRow()];
    setPhoneRows(remaining);
    // Deleting the empty first row can promote a filled one into its place.
    if ((remaining[0]?.phone ?? "").trim()) clearContactError("phone");
  };

  const setPhoneRow = (index: number, value: string) => {
    setPhoneRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, phone: value } : row)),
    );
    if (index === 0 && value.trim()) clearContactError("phone");
  };

  async function savePhones(): Promise<boolean> {
    // Validate every non-empty row before writing anything.
    const normalized = phoneRows.map((row) =>
      row.phone.trim() ? normalizePhone(row.phone) : "",
    );
    for (let i = 0; i < phoneRows.length; i++) {
      if (phoneRows[i].phone.trim() && !normalized[i]) {
        toast.error(t("invalidPhone", { phone: phoneRows[i].phone }));
        return false;
      }
    }

    // Deletes first: this frees a number that a later row may be taking over.
    const toDelete = new Set(removedPhoneIds);
    phoneRows.forEach((row, i) => {
      if (row.id && !normalized[i]) toDelete.add(row.id);
    });
    for (const id of toDelete) {
      const result = await removeMyPhone(id);
      if (!result.success) {
        toast.error(result.error ?? t("removePhoneFailed"));
        return false;
      }
    }

    // Edits on stored rows whose number changed.
    for (let i = 0; i < phoneRows.length; i++) {
      const row = phoneRows[i];
      if (!row.id || !normalized[i] || normalized[i] === row.initial) continue;
      const result = await updateMyPhone(row.id, normalized[i]);
      if (!result.success) {
        toast.error(result.error ?? t("updatePhoneFailed"));
        return false;
      }
    }

    // Then the rows being added.
    const createdByPhone = new Map<string, MyPhoneRow>();
    for (let i = 0; i < phoneRows.length; i++) {
      const row = phoneRows[i];
      if (row.id || !normalized[i]) continue;
      const result = await addMyPhone(normalized[i]);
      if (!result.success || !result.phone) {
        toast.error(result.error ?? t("addPhoneFailed"));
        return false;
      }
      createdByPhone.set(normalized[i], result.phone);
    }

    // Reflect the stored state so a second submit cannot repeat a write.
    const nextRows: PhoneRow[] = [];
    for (let i = 0; i < phoneRows.length; i++) {
      const row = phoneRows[i];
      if (!normalized[i]) continue; // cleared or removed
      if (row.id) {
        nextRows.push({
          id: row.id,
          phone: formatPhoneLocal(normalized[i]),
          initial: normalized[i],
        });
        continue;
      }
      const created = createdByPhone.get(normalized[i]);
      if (created) {
        nextRows.push({
          id: created.id,
          phone: formatPhoneLocal(created.phone),
          initial: created.phone,
        });
      }
    }
    setPhoneRows(nextRows.length > 0 ? nextRows : [emptyPhoneRow()]);
    setRemovedPhoneIds([]);
    return true;
  }

  /**
   * The contact trio is required only while "Update this contact to your ads"
   * is ticked: that switch is what copies the contact onto every ad, and an
   * unticked switch must still let the user clear fields freely.
   */
  function validateAdsContact(): boolean {
    if (!updateAdsContact) {
      setContactErrors({});
      return true;
    }
    const next: typeof contactErrors = {};
    if (!(phoneRows[0]?.phone ?? "").trim()) {
      next.phone = t("phoneRequired");
    }
    if (!placeLabel(place)) next.location = t("required");
    if (!address.trim()) next.address = t("required");
    setContactErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!canSubmit) return;
    if (!validateAdsContact()) return;

    setSaving(true);

    const phonesOk = await savePhones();
    if (!phonesOk) {
      setSaving(false);
      return;
    }

    const result = await updateMyProfile({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gender,
      // An empty picker clears the birthday rather than leaving the old one.
      dateOfBirth: dateOfBirth ? toIsoDate(dateOfBirth) : null,
      email: email.trim() || null,
      company: company.trim() || null,
      // The cascade is always sent in full, so clearing it clears the account.
      provinceId: place.province?.id ?? null,
      districtId: place.district?.id ?? null,
      communeId: place.commune?.id ?? null,
      address: address.trim() || null,
      // Always sent: null removes a saved pin.
      latitude: coords ? coords.lat : null,
      longitude: coords ? coords.lng : null,
      updateAdsContact,
    });

    if (!result.success) {
      toast.error(result.error ?? t("saveFailed"));
      setSaving(false);
      return;
    }

    toast.success(t("saved"));
    setSaving(false);
    // Re-renders the rail, the hub and the navbar chip from the new row.
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-muted pb-30 pt-4">
      <div className="max-w-6xl mx-auto  ">
        <div className="flex gap-5 ">
          <SettingSidebar me={me} />
          <main className="flex-1">
            <div className="bg-card border border-border rounded-sm">
              <h1 className="type-page-title text-foreground mb-4 mt-4 px-4">
                {t("title")}
              </h1>
              <div className="mt-2 px-4 space-y-4">
                <Field>
                  <FieldLabel htmlFor="first-name">
                    {t("firstName")} <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="first-name"
                    placeholder={t("firstName")}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    maxLength={100}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="last-name">
                    {t("lastName")} <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="last-name"
                    placeholder={t("lastName")}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    maxLength={100}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("gender")}</FieldLabel>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setGender("male")}
                      className={`flex-1 border py-1.5 rounded-sm cursor-pointer ${
                        gender === "male"
                          ? "border-sky-400 bg-sky-100 text-sky-600"
                          : "border-border"
                      }`}
                    >
                      {t("male")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGender("female")}
                      className={`flex-1 border py-1.5 rounded-sm cursor-pointer ${
                        gender === "female"
                          ? "border-sky-400 bg-sky-100 text-sky-600"
                          : "border-border"
                      }`}
                    >
                      {t("female")}
                    </button>
                  </div>
                </Field>
                <Field className="mx-auto ">
                  <FieldLabel htmlFor="date-of-birth">
                    {t("dateOfBirth")}
                  </FieldLabel>
                  <DateOfBirthPicker
                    id="date-of-birth"
                    value={dateOfBirth}
                    onChange={setDateOfBirth}
                    // Legacy accounts only carry a year — open there without
                    // pretending a full date was chosen.
                    defaultMonth={
                      me.yearOfBirth
                        ? new Date(me.yearOfBirth, 0, 1)
                        : undefined
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="company">{t("company")}</FieldLabel>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    maxLength={150}
                  />
                </Field>
                {phoneRows.map((row, index) => {
                  const isLast = index === phoneRows.length - 1;
                  return (
                    <div
                      key={row.id ?? `new-${index}`}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <div className="flex-1">
                        <Field>
                          <FieldLabel htmlFor={`phone-${index}`}>
                            {index === 0
                              ? t("phoneNumber")
                              : t("phoneNumberN", { n: index + 1 })}
                            {index === 0 && updateAdsContact && (
                              <span className="text-destructive">*</span>
                            )}
                          </FieldLabel>
                          <Input
                            id={`phone-${index}`}
                            value={row.phone}
                            placeholder="012 345 678"
                            onChange={(e) => setPhoneRow(index, e.target.value)}
                            aria-invalid={
                              index === 0 && Boolean(contactErrors.phone)
                            }
                          />
                        </Field>
                      </div>
                      {phoneRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePhoneRow(index)}
                          aria-label={t("removePhone", { n: index + 1 })}
                          className="mb-0.5 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-red-500 text-red-500 transition-colors hover:bg-red-50"
                        >
                          <Minus className="h-4 w-4" strokeWidth={3} />
                        </button>
                      )}
                      {isLast && phoneRows.length < MAX_PHONES && (
                        <button
                          type="button"
                          onClick={addPhoneRow}
                          aria-label={t("addPhone")}
                          className="mb-0.5 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#00a0e9] text-card transition-colors hover:bg-[#00a0e9]/80"
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      )}
                      {index === 0 && contactErrors.phone && (
                        <FieldDescription className="w-full text-destructive">
                          {contactErrors.phone}
                        </FieldDescription>
                      )}
                    </div>
                  );
                })}

                {/* LocationPicker renders its own "Location" label — wrapping
                    it in another FieldLabel duplicated the heading. */}
                <LocationPicker
                  provinces={provinces}
                  value={place}
                  onChange={(next) => {
                    setPlace(next);
                    if (placeLabel(next)) clearContactError("location");
                  }}
                  required={updateAdsContact}
                  error={contactErrors.location}
                />
                <FieldSet className="w-full">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="address">
                        {t("address")}
                        {updateAdsContact && (
                          <span className="text-destructive">*</span>
                        )}
                      </FieldLabel>
                      <Textarea
                        id="address"
                        placeholder={t("addressPlaceholder")}
                        rows={4}
                        value={address}
                        onChange={(e) => {
                          setAddress(e.target.value);
                          if (e.target.value.trim())
                            clearContactError("address");
                        }}
                        aria-invalid={Boolean(contactErrors.address)}
                      />
                      {contactErrors.address && (
                        <FieldDescription className="text-destructive">
                          {contactErrors.address}
                        </FieldDescription>
                      )}
                    </Field>
                  </FieldGroup>
                </FieldSet>
                {/* Same picker the post form uses: preview strip + Leaflet
                    dialog. Coordinates save to the profile like any field. */}
                <LocationMapPicker value={coords} onChange={setCoords} />
                <Field orientation="horizontal">
                  <Checkbox
                    id="update-ads-contact"
                    name="update-ads-contact"
                    checked={updateAdsContact}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setUpdateAdsContact(next);
                      // Unticking drops the requirement, so its errors go too.
                      if (!next) setContactErrors({});
                    }}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="update-ads-contact">
                      {t("updateAdsContact")}
                    </FieldLabel>
                  </FieldContent>
                </Field>
                <Button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  className="bg-orange-500 text-card rounded-sm w-full h-8 mb-4 cursor-pointer"
                >
                  {saving ? t("saving") : t("submit")}
                </Button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
