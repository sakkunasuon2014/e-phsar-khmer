import type { ReactNode } from "react";

/** Title, description, primary action and a search/filter toolbar — the shell every admin list page shares. */
export function AdminPage({
  title,
  description,
  action,
  toolbar,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex-1 overflow-auto p-6 min-w-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="type-page-title tracking-tight text-[#00a0e9]">
              {title}
            </h1>
            <p className="type-body-sm mt-2 text-muted-foreground">
              {description}
            </p>
          </div>
          {action}
        </div>
        {toolbar ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {toolbar}
          </div>
        ) : null}
        {children}
      </div>
    </main>
  );
}
