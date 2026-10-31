"use client";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldSet, FieldGroup } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import SettingSidebar from "../setting/SettingSidebar";
import { useState } from "react";

const DEPARTMENTS = [
  "engineering",
  "design",
  "marketing",
  "sales",
  "support",
  "hr",
  "finance",
  "operations",
] as const;

export default function AddAddress() {
  const t = useTranslations("Me.billing");
  const tCommon = useTranslations("Common");
  const tSettings = useTranslations("Settings");
  const [autoUpdate, setAutoUpdate] = useState(false);
  return (
    <div className="min-h-screen bg-muted pb-10 pt-4">
      <div className="max-w-6xl mx-auto  ">
        <div className="flex gap-5 ">
          <SettingSidebar />
          <main className="flex-1">
            <div className="bg-card border border-border rounded-sm">
              <h1 className="type-page-title text-foreground mb-4 mt-4 px-4">
                {t("addTitle")}
              </h1>
              <div className="mt-2 px-4 space-y-4">
                <Field>
                  <FieldLabel htmlFor="input-required">
                    {t("name")} <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="input-required"
                    placeholder={t("firstNamePlaceholder")}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="input-required">
                    {t("company")}
                  </FieldLabel>
                  <Input
                    id="input-required"
                    placeholder={t("company")}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="input-required">{t("email")}</FieldLabel>
                  <Input
                    id="input-required"
                    placeholder="[EMAIL_ADDRESS]"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="input-required">
                    {t("phoneNumber")}{" "}
                    <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="input-required"
                    placeholder="+855 12 345 678"
                    required
                  />
                </Field>
                <Field className="w-full">
                  <FieldLabel>{t("location")}</FieldLabel>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder={t("chooseLocation")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {DEPARTMENTS.map((department) => (
                          <SelectItem key={department} value={department}>
                            {t(`departments.${department}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <FieldSet className="w-full">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="address">{t("address")}</FieldLabel>
                      <Textarea
                        id="address"
                        placeholder={t("addressPlaceholder")}
                        rows={4}
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
                <Field className="w-full">
                  <FieldLabel>{t("selectLocation")}</FieldLabel>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectLocation")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {DEPARTMENTS.map((department) => (
                          <SelectItem key={department} value={department}>
                            {t(`departments.${department}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="input-required">{t("taxId")}</FieldLabel>
                  <Input
                    id="input-required"
                    placeholder={t("taxId")}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="input-required">
                    {t("gender")}
                  </FieldLabel>
                  <div className="flex gap-2">
                    <button className="flex-1 border border-sky-400 bg-sky-100 text-sky-600 py-1.5 rounded-sm">
                      {t("home")}
                    </button>
                    <button className="flex-1 border border-border py-1.5 rounded-sm">
                      {t("work")}
                    </button>
                    <button className="flex-1 border border-border py-1.5 rounded-sm">
                      {t("other")}
                    </button>
                  </div>
                </Field>
                <Field
                  orientation="horizontal"
                  onClick={() => {
                    toast.promise<{ name: string }>(
                      () =>
                        new Promise((resolve) =>
                          setTimeout(
                            () => resolve({ name: tSettings("storeName") }),
                            2000,
                          ),
                        ),
                      {
                        loading: tSettings("loading"),
                        success: (data) =>
                          tSettings("savedToast", { name: data.name }),
                        position: "top-right",
                        error: tSettings("error"),
                      },
                    );
                    setAutoUpdate(!autoUpdate);
                  }}
                  className="flex items-center justify-between p-3 bg-card border border-muted-foreground/20 rounded-sm cursor-pointer"
                >
                  <FieldLabel className="px-1 text-muted-foreground cursor-pointer">
                    {t("setAsDefault")}
                  </FieldLabel>

                  <Switch
                    checked={autoUpdate}
                    onCheckedChange={setAutoUpdate}
                    className="data-[state=checked]:bg-[#00a0e9] data-[state=unchecked]:bg-input scale-120 mr-2"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button className="bg-muted-foreground/40 text-card rounded-sm w-1/2 h-10 mb-4">
                    {tCommon("cancel")}
                  </Button>
                  <Button className="bg-orange-500 text-card rounded-sm w-1/2 h-10 mb-4">
                    {tCommon("submit")}
                  </Button>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
