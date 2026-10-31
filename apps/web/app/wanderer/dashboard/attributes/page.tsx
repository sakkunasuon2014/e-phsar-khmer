import Link from "next/link";
import { ATTRIBUTE_TYPES } from "@/lib/attribute-types";

const ATTRIBUTES = [
  { href: "/wanderer/dashboard/attributes/brands", title: "Brands" },
  { href: "/wanderer/dashboard/attributes/models", title: "Models" },
  ...ATTRIBUTE_TYPES.map((a) => ({
    href: `/wanderer/dashboard/attributes/${a.type}`,
    title: a.title,
  })),
] as const;

export default function AttributePage() {
  return (
    <main className="flex-1 overflow-auto p-6 min-w-0">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="type-page-title text-[#00a0e9] tracking-tight">
            Attributes
          </h1>
          <p className="type-body-sm text-muted-foreground mt-2">
            Manage the option sets used by listing forms.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ATTRIBUTES.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="rounded-lg border border-border bg-card px-4 py-3 type-nav hover:border-[#00a0e9] hover:text-[#00a0e9] transition-colors"
            >
              {a.title}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
