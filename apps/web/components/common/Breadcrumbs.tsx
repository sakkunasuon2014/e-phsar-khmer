import { Fragment, type ComponentProps, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, House } from "lucide-react";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";

type CrumbHref = ComponentProps<typeof Link>["href"];

export interface Crumb {
  label: ReactNode;
  /** Omit on the current (last) crumb — it renders as the page indicator. */
  href?: CrumbHref;
  /** Extra classes for this crumb (e.g. `capitalize`). */
  className?: string;
}

/**
 * The app-wide breadcrumb trail — the `/en/premium-account` design at the
 * `text-base` scale: lucide house + chevrons at 16px, 8px gaps, theme-blue
 * hover `#00a0e9`. The first crumb carries the house icon; an href-less crumb
 * renders as the current page. Only the row lives here — each page keeps its
 * own band/container around it.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: Crumb[];
  className?: string;
}) {
  const t = useTranslations("Common");
  return (
    <nav
      aria-label={t("breadcrumb")}
      className={cn("flex items-center space-x-2 type-body", className)}
    >
      {items.map((item, index) => {
        const isFirst = index === 0;
        return (
          <Fragment key={index}>
            {/* Icons carry a 1px upward optical nudge — the line box's midline
                sits ~1px below the cap-ink centre of the text. */}
            {!isFirst && (
              <ChevronRight
                size={16}
                className="block -translate-y-px text-gray-500"
              />
            )}
            {item.href ? (
              <Link
                href={item.href}
                className={cn(
                  "group flex items-center transition-colors duration-150 group-hover:text-[#00a0e9]",
                  item.className,
                )}
              >
                {isFirst && (
                  <House
                    size={16}
                    className="-translate-y-px text-foreground group-hover:text-[#00a0e9]"
                  />
                )}
                <span className="text-foreground group-hover:text-[#00a0e9] pl-1.5">
                  {item.label}
                </span>
              </Link>
            ) : (
              <h1
                className={cn(
                  "type-body text-gray-500 dark:text-gray-400",
                  item.className,
                )}
              >
                {item.label}
              </h1>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
