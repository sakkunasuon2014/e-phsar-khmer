"use client";

import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/i18n/routing";
import { ChevronRight } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { AccountIdentity } from "./AccountIdentity";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { LinkedAccountsRows } from "./LinkedAccountsRows";
import { SignOutDialog } from "./SignOutDialog";
import { formatPhoneLocal } from "@/lib/phone";
import type { SettingsUser } from "@/lib/auth/current-user";

/** The settings hub: a full-width list of account rows. */
export default function Settings({ me }: { me?: SettingsUser | null }) {
  const [autoUpdate, setAutoUpdate] = useState(false);
  return (
    <div className="min-h-screen bg-muted pb-30 pt-2">
      <div className="max-w-6xl mx-auto px-4 ">
        <main className="max-w-4xl mx-auto px-4">
          <h1 className="type-page-title text-foreground mb-4 mt-2">
            Settings
          </h1>

          <Link
            href={{ pathname: "/settings/edit-profile" }}
            className="flex items-center justify-between p-2 bg-card hover:bg-background/50 rounded-sm border border-transparent hover:border-border"
          >
            <AccountIdentity me={me} />
            <ChevronRight size={24} className="text-gray-300" />
          </Link>
          <div className="mt-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Account
            </h3>
            <Link
              href={{ pathname: "/settings/edit-profile" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-t-lg border border-transparent hover:border-border"
            >
              <p className="px-1">Edit Profile</p>
              <p className="flex items-center opacity-50 gap-1">
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <Link
              href={{ pathname: "/settings/change-password" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border"
            >
              <p className="px-1">Change Password</p>
              <p className="flex items-center opacity-50 gap-1">
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <Link
              href={{ pathname: "/settings/change-username" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border"
            >
              <p className="px-1">Username</p>
              <p className="flex items-center opacity-50 gap-1">
                {me?.username ?? ""}
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <Link
              href={{ pathname: "/settings/change-phone" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border"
            >
              <p className="px-1">Activate Phone</p>
              <p className="flex items-center opacity-50 gap-1">
                {me?.primaryPhone ? formatPhoneLocal(me.primaryPhone) : "Add"}
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <LinkedAccountsRows me={me} />
            <Separator />
            <Link
              href={{ pathname: "/settings/passkeys" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border"
            >
              <p className="px-1">Passkeys</p>
              <p className="flex items-center opacity-50 capitalize gap-1">
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <Link
              href={{ pathname: "/settings/devices" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border"
            >
              <p className="px-1">Devices</p>
              <p className="flex items-center opacity-50 capitalize gap-1">
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <Field
              orientation="horizontal"
              onClick={() => {
                toast.promise<{ name: string }>(
                  () =>
                    new Promise((resolve) =>
                      setTimeout(() => resolve({ name: "Your store" }), 2000),
                    ),
                  {
                    loading: "Loading...",
                    success: (data) =>
                      `${data.name} setting has been saved successfully`,
                    position: "top-right",
                    error: "Error",
                  },
                );
                setAutoUpdate(!autoUpdate);
              }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border cursor-pointer transition-colors"
            >
              <FieldLabel className="px-1 font-normal text-base cursor-pointer">
                Auto Update Profile Picture
              </FieldLabel>

              <Switch
                checked={autoUpdate}
                onCheckedChange={setAutoUpdate}
                className="data-[state=checked]:bg-[#00a0e9] data-[state=unchecked]:bg-input scale-120 mr-2"
              />
            </Field>
            <Separator />
            <DeleteAccountDialog
              username={me?.username ?? ""}
              trigger={
                <button className="w-full flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border cursor-pointer">
                  <p className="px-1 ">Delete Account</p>
                </button>
              }
            />
            <Separator />
            <Link
              href={{ pathname: "/settings/privacy" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border"
            >
              <p className="px-1">Privacy</p>
              <p className="flex items-center opacity-50 gap-1">
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <Link
              href={{ pathname: "/me/subscriptions" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-none border border-transparent hover:border-border"
            >
              <p className="px-1">Subscription &amp; Plan</p>
              <p className="flex items-center opacity-50 gap-1">
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <Separator />
            <Link
              href={{ pathname: "/me/billing-addresses" }}
              className="flex items-center justify-between p-3 bg-card hover:bg-background/50 rounded-b-lg border border-transparent hover:border-border"
            >
              <p className="px-1">Billing Address</p>
              <p className="flex items-center opacity-50 gap-1">
                <ChevronRight size={24} className="text-gray-300" />
              </p>
            </Link>
            <div className="mt-4">
              <SignOutDialog
                trigger={
                  <button className="flex w-full items-center justify-center p-2.5 h-10 bg-card hover:bg-red-700/90 rounded-full border border-transparent hover:border-red-500/20 group transition-colors cursor-pointer">
                    <p className="text-red-500 font-medium group-hover:text-white">
                      Sign Out
                    </p>
                  </button>
                }
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
