"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Laptop, LogOut, Monitor, Smartphone, Tablet } from "lucide-react";
import { useRouter } from "@/i18n/routing";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { revokeDevice, revokeOtherDevices } from "@/actions/devices";
import { getDeviceIdentity } from "@/lib/device";
import type { DeviceView, LoginDevice } from "@/types/device";

function isMobile(device: LoginDevice): boolean {
  return (
    device.clientType === "app" ||
    device.osName === "iOS" ||
    device.osName === "Android"
  );
}

/** "Chrome 154", "PKG110", "iPhone", or the stored label as a fallback. */
function deviceTitle(device: LoginDevice, unknown: string): string {
  if (isMobile(device)) {
    if (device.deviceModel) return device.deviceModel;
    if (device.osName === "iOS") return "iPhone";
    return device.osName ?? device.name ?? unknown;
  }
  if (device.browserName) {
    const major = device.browserVersion?.split(".")[0];
    return major ? `${device.browserName} ${major}` : device.browserName;
  }
  return device.name || unknown;
}

/** "Browser 2026.10.20" / "App 2026.10.20"; null on a legacy row. */
function clientLine(
  device: LoginDevice,
  app: string,
  browser: string,
): string | null {
  if (!device.clientType && !device.clientVersion) return null;
  const kind = device.clientType === "app" ? app : browser;
  return device.clientVersion ? `${kind} ${device.clientVersion}` : kind;
}

function DeviceIcon({ device, size }: { device: LoginDevice; size: number }) {
  if (isMobile(device)) {
    return /iPad|Tablet/i.test(device.deviceModel ?? "") ? (
      <Tablet size={size} />
    ) : (
      <Smartphone size={size} />
    );
  }
  // A bare legacy row carries no browser identity; the mock draws a laptop.
  if (!device.browserName && !device.clientType) return <Laptop size={size} />;
  return <Monitor size={size} />;
}

export function DeviceList({
  devices,
  loadError,
}: {
  devices: DeviceView[];
  loadError: boolean;
}) {
  const t = useTranslations("Settings.devicesPage");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const current = devices.find((device) => device.isCurrent) ?? null;
  const others = devices.filter((device) => !device.isCurrent);

  // Legacy recovery: a session issued before `sid` may have a localStorage id
  // but no mirrored cookie yet. Write it and let the RSC re-read once; the
  // ref prevents a refresh loop when the id matches no row.
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || current || devices.length === 0) return;
    synced.current = true;
    if (getDeviceIdentity()) router.refresh();
  }, [current, devices.length, router]);

  async function handleRevoke(id: string) {
    setPendingId(id);
    try {
      const result = await revokeDevice(id);
      if (result.success) {
        toast.success(t("revoked"));
        router.refresh();
      } else {
        toast.error(result.error ?? t("revokeFailed"));
      }
    } finally {
      setPendingId(null);
    }
  }

  async function handleRevokeOthers() {
    setRevokingOthers(true);
    try {
      const result = await revokeOtherDevices();
      if (result.success) {
        setConfirmOpen(false);
        toast.success(t("othersRevoked"));
        router.refresh();
      } else {
        toast.error(result.error ?? t("othersRevokeFailed"));
      }
    } finally {
      setRevokingOthers(false);
    }
  }

  if (loadError) {
    return (
      <div className="bg-card border border-border rounded-sm p-6 type-body-sm text-muted-foreground">
        {t("loadFailed")}
      </div>
    );
  }

  return (
    <>
      <section className="space-y-3">
        <h2 className="type-meta text-muted-foreground uppercase tracking-wider">
          {t("thisDevice")}
        </h2>
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="p-4 flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 text-[#00a0e9]">
              {current ? (
                <DeviceIcon device={current} size={24} />
              ) : (
                <Monitor size={24} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="type-body-sm text-foreground">
                {current
                  ? deviceTitle(current, t("unknown"))
                  : t("unknownDevice")}
              </h3>
              {current && clientLine(current, t("app"), t("browser")) && (
                <p className="type-meta text-muted-foreground">
                  {clientLine(current, t("app"), t("browser"))}
                </p>
              )}
              {current ? (
                <div className="flex gap-2 mt-1">
                  <span className="type-meta text-muted-foreground">
                    {t("created", { date: current.createdLabel })}
                  </span>
                  <span className="type-meta text-muted-foreground">•</span>
                  <span className="type-meta text-muted-foreground">
                    {t("lastUsed", { date: current.lastSeenLabel })}
                  </span>
                </div>
              ) : (
                <p className="type-meta text-muted-foreground mt-1">
                  {t("couldNotIdentify")}
                </p>
              )}
            </div>
          </div>

          {current && others.length > 0 && (
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="w-full py-3 px-4 flex items-center gap-2 border-t border-border hover:bg-muted/50 transition-colors text-red-500 type-nav"
                >
                  <LogOut size={16} />
                  {t("logOutOthers")}
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[480px] rounded-sm">
                <DialogHeader>
                  <DialogTitle>{t("logOutOthersTitle")}</DialogTitle>
                  <DialogDescription className="mt-2 text-muted-foreground">
                    {t("logOutOthersDescription")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex flex-row gap-2 mt-4">
                  <DialogClose asChild>
                    <Button
                      variant="ghost"
                      className="flex-1 border border-border hover:bg-card cursor-pointer"
                    >
                      {tCommon("cancel")}
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    onClick={() => void handleRevokeOthers()}
                    disabled={revokingOthers}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-medium cursor-pointer"
                  >
                    {revokingOthers ? t("signingOut") : t("logOutOthersButton")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <p className="type-meta text-muted-foreground">{t("logsOutAll")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="type-meta text-muted-foreground uppercase tracking-wider">
          {t("otherLogins")}
        </h2>
        <div className="bg-card border border-border rounded-sm divide-y divide-border">
          {others.length === 0 ? (
            <p className="p-4 type-body-sm text-muted-foreground">
              {t("onlyThisDevice")}
            </p>
          ) : (
            others.map((device) => (
              <div
                key={device.id}
                className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-muted-foreground">
                    <DeviceIcon device={device} size={20} />
                  </div>
                  <div>
                    <h3 className="type-body-sm text-foreground">
                      {deviceTitle(device, t("unknown"))}
                    </h3>
                    {clientLine(device, t("app"), t("browser")) && (
                      <p className="type-meta text-muted-foreground">
                        {clientLine(device, t("app"), t("browser"))}
                      </p>
                    )}
                    <p className="type-meta text-muted-foreground">
                      {t("lastActive", { date: device.lastSeenLabel })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(device.id)}
                  disabled={pendingId === device.id}
                  aria-label={t("signOutAria", {
                    device: deviceTitle(device, t("unknown")),
                  })}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-full transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <LogOut size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
