import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Globe, MapPin, CircleCheckBig } from "lucide-react";
import { IconPhone, IconMailFilled } from "@tabler/icons-react";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/i18n/routing";
import type { User } from "@/lib/user";

/** The identity subset the About card renders — the header owns the rest. */
type AboutUser = Pick<
  User,
  "username" | "verified" | "phone" | "email" | "userlink" | "locations"
>;

export default function AboutProfile({ user }: { user: AboutUser }) {
  const t = useTranslations("Me.about");
  // Each row renders only when the profile actually carries that detail. A real
  // profile exposes no phone, email, link or location, and the captain's rule
  // is that an empty row is worse than no row (2026-09-24).
  const rows: ReactNode[] = [
    <div key="verified" className="flex items-center gap-2 px-3 pt-4">
      <CircleCheckBig className="text-muted-foreground scale-90" />
      {user.verified ? t("verified") : t("notVerified")}
    </div>,
  ];

  if (user.phone?.length) {
    rows.push(
      <div key="phone" className="flex items-center gap-2 px-3">
        <IconPhone className="text-muted-foreground scale-90" />
        {user.phone.join(", ")}
      </div>,
    );
  }

  if (user.email) {
    rows.push(
      <div key="email" className="flex items-center gap-2 px-3">
        <IconMailFilled className="text-muted-foreground scale-90" />
        <a href={`mailto:${user.email}`} className="text-[#00a0e9]">
          {user.email}
        </a>
      </div>,
    );
  }

  if (user.userlink) {
    // A `@handle` is this site's own profile — link it to the real public
    // page rather than rendering a bare `href="@name"`. Anything else keeps
    // the plain-anchor behaviour.
    const handle = user.userlink.startsWith("@")
      ? user.username || user.userlink.slice(1)
      : null;
    rows.push(
      <div key="link" className="flex items-center gap-2 px-3">
        <Globe className="text-muted-foreground scale-90" />
        {handle ? (
          <Link
            href={{ pathname: "/[username]", params: { username: handle } }}
            className="text-[#00a0e9] hover:underline truncate"
          >
            {user.userlink}
          </Link>
        ) : (
          <a
            href={user.userlink}
            target="_self"
            rel="noreferrer"
            className="text-[#00a0e9] hover:underline truncate"
          >
            {user.userlink}
          </a>
        )}
      </div>,
    );
  }

  if (user.locations) {
    rows.push(
      <div key="location" className="flex items-center gap-2 px-3">
        <MapPin className="text-muted-foreground scale-90" />
        {user.locations}
      </div>,
    );
  }

  return (
    <div className="bg-muted">
      <div className="max-w-7xl mx-auto pb-50 px-4 pt-3">
        <h1 className="type-page-title">{t("title")}</h1>
        <main className="max-w-7xl mx-auto mt-6">
          <div className="bg-card rounded-sm p-3 pb-10 space-y-3 shadow-sm">
            <p className="type-card-heading px-3 pt-3">{t("overview")}</p>

            {/* Each row carries its own divider, so hiding one leaves no
                dangling line behind it. */}
            {rows.map((row, i) => (
              <div key={i}>
                {row}
                {i < rows.length - 1 && (
                  <div className="px-3">
                    <Separator className="my-3" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
