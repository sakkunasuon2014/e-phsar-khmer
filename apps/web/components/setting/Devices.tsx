import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { MONTH_LABELS } from "@/lib/locale-labels";
import SettingSidebar from "./SettingSidebar";
import { DeviceList } from "./device-list";
import { getSettingsUser } from "@/lib/auth/current-user";
import { listMyDevices } from "@/lib/api/devices";
import type { DeviceView, LoginDevice } from "@/types/device";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function relativeLabel(
  format: Awaited<ReturnType<typeof getFormatter>>,
  locale: string,
  iso: string,
  now: Date,
): string {
  const date = new Date(iso);
  const age = now.getTime() - date.getTime();
  if (age >= 0 && age < WEEK_MS) return format.relativeTime(date, now);

  // The mock's absolute style: "30, Dec 2025" (day, abbreviated month, year).
  const month =
    (MONTH_LABELS[locale] ?? MONTH_LABELS.en)[date.getMonth()] ?? "";
  return `${String(date.getDate()).padStart(2, "0")}, ${month} ${date.getFullYear()}`;
}

export default async function DeviceSettings() {
  const me = await getSettingsUser();
  const t = await getTranslations("Settings.devicesPage");

  // Fail soft: the settings shell must still render if the API hiccups.
  let devices: DeviceView[] = [];
  let loadError = false;
  try {
    const rows: LoginDevice[] = await listMyDevices();
    const format = await getFormatter();
    const locale = await getLocale();
    const now = new Date();
    devices = rows.map((row) => ({
      ...row,
      createdLabel: relativeLabel(format, locale, row.firstSeenAt, now),
      lastSeenLabel: relativeLabel(format, locale, row.lastSeenAt, now),
    }));
  } catch {
    loadError = true;
  }

  return (
    <div className="min-h-screen bg-muted pb-10 pt-4">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex gap-5">
          <SettingSidebar me={me} />

          <main className="flex-1 space-y-6">
            <h1 className="type-page-title text-foreground">{t("title")}</h1>
            <DeviceList devices={devices} loadError={loadError} />
          </main>
        </div>
      </div>
    </div>
  );
}
