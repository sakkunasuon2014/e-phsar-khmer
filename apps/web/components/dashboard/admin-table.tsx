"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Copy,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DbImage from "@/components/common/DbImage";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/**
 * The shared admin table. Pages declare columns; the table owns sorting,
 * pagination, the empty/loading state and the row action menu, so a page can
 * never drift from the others (or hand-count a `colSpan`).
 */
export type AdminColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables click-to-sort on the header. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "center" | "right";
  className?: string;
};

type SortState = { key: string; dir: "asc" | "desc" };

const ALIGN: Record<"left" | "center" | "right", string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const PAGE_SIZES = [10, 20, 50, 100];

/** Tab/badge counts stay readable: anything past 99 renders as "99+". */
export function formatCount(count: number | undefined): string {
  if (count === undefined) return "…";
  return count > 99 ? "99+" : String(count);
}

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  emptyTitle = "Nothing here yet",
  emptyHint,
  pageSize,
  initialSort,
  resetKey,
  serverPagination,
}: {
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyHint?: ReactNode;
  /** Omit to render every row without the pagination footer. */
  pageSize?: number;
  initialSort?: SortState;
  /** Page one is restored whenever this changes (search/filter input). */
  resetKey?: string | number;
  /**
   * Server-side paging: the rows prop is already one page, so the table renders
   * them whole and the footer drives the caller's page state instead of slicing.
   */
  serverPagination?: {
    page: number;
    totalPages: number;
    total: number;
    onPageChange: (page: number) => void;
    /** Noun after the total, e.g. "listings". */
    totalLabel?: string;
  };
}) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  // The page is keyed to the current filter: when the key no longer matches,
  // the derived page is one, so a new search always starts at the top without
  // an effect (setState-in-effect is banned by the repo's lint rules).
  const [pageState, setPageState] = useState<{
    key: string | number | undefined;
    page: number;
  }>({ key: resetKey, page: 1 });
  const [size, setSize] = useState(pageSize ?? 20);

  // Adjusting state during render (React's recommended derived-state pattern):
  // a changed search/filter starts at page one without an effect, and the old
  // page cannot resurface when a previous filter value comes back.
  if (pageState.key !== resetKey) {
    setPageState({ key: resetKey, page: 1 });
  }

  const storedPage = pageState.key === resetKey ? pageState.page : 1;
  const setPage = (next: number | ((value: number) => number)) =>
    setPageState((previous) => {
      const base = previous.key === resetKey ? previous.page : 1;
      return {
        key: resetKey,
        page: typeof next === "function" ? next(base) : next,
      };
    });

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const accessor = columns.find(
      (column) => column.key === sort.key,
    )?.sortValue;
    if (!accessor) return rows;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = accessor(left);
      const b = accessor(right);
      if (typeof a === "number" && typeof b === "number") {
        return (a - b) * direction;
      }
      return (
        String(a).localeCompare(String(b), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * direction
      );
    });
  }, [rows, sort, columns]);

  const paginated = pageSize !== undefined && !serverPagination;
  const totalPages = paginated
    ? Math.max(1, Math.ceil(sorted.length / size))
    : 1;
  const currentPage = Math.min(storedPage, totalPages);
  const visible = paginated
    ? sorted.slice((currentPage - 1) * size, currentPage * size)
    : sorted;

  const toggleSort = (key: string) =>
    setSort((previous) =>
      previous?.key === key
        ? { key, dir: previous.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  ALIGN[column.align ?? "left"],
                  column.sortValue && "cursor-pointer select-none",
                  column.className,
                )}
              >
                {column.sortValue ? (
                  <button
                    type="button"
                    aria-label={`Sort by ${column.header}`}
                    onClick={() => toggleSort(column.key)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {column.header}
                    {sort?.key === column.key ? (
                      sort.dir === "asc" ? (
                        <ArrowUp className="size-3.5" />
                      ) : (
                        <ArrowDown className="size-3.5" />
                      )
                    ) : (
                      <ChevronsUpDown className="size-3.5 text-muted-foreground/60" />
                    )}
                  </button>
                ) : (
                  column.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && rows.length === 0 ? (
            Array.from({ length: 5 }).map((_, index) => (
              <TableRow key={`skeleton-${index}`}>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={ALIGN[column.align ?? "left"]}
                  >
                    <div className="h-4 w-full max-w-[160px] animate-pulse rounded bg-muted" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-32 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Search className="size-8" />
                  <p>{emptyTitle}</p>
                  {emptyHint ? (
                    <p className="type-body-sm">{emptyHint}</p>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ) : (
            visible.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      ALIGN[column.align ?? "left"],
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {serverPagination ? (
        <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="type-body-sm text-muted-foreground">
            {serverPagination.total} {serverPagination.totalLabel ?? "rows"}
          </span>
          <div className="flex items-center gap-2">
            <span className="type-body-sm text-muted-foreground">
              Page {serverPagination.page} of{" "}
              {Math.max(1, serverPagination.totalPages)}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => serverPagination.onPageChange(1)}
                disabled={serverPagination.page <= 1}
                aria-label="First page"
              >
                <ChevronsLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() =>
                  serverPagination.onPageChange(serverPagination.page - 1)
                }
                disabled={serverPagination.page <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() =>
                  serverPagination.onPageChange(serverPagination.page + 1)
                }
                disabled={serverPagination.page >= serverPagination.totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() =>
                  serverPagination.onPageChange(serverPagination.totalPages)
                }
                disabled={serverPagination.page >= serverPagination.totalPages}
                aria-label="Last page"
              >
                <ChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : paginated ? (
        <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 type-body-sm text-muted-foreground">
            <span>Rows per page</span>
            <Select
              value={String(size)}
              onValueChange={(value) => {
                setSize(Number(value));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-2">{sorted.length} rows</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="type-body-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => setPage(1)}
                disabled={currentPage === 1}
                aria-label="First page"
              >
                <ChevronsLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() =>
                  setPage((value) => Math.min(totalPages, value + 1))
                }
                disabled={currentPage === totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => setPage(totalPages)}
                disabled={currentPage === totalPages}
                aria-label="Last page"
              >
                <ChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminSearch({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 border-border bg-card pl-9 text-foreground transition-all focus-visible:border-[#00a0e9] focus-visible:ring-1 focus-visible:ring-[#00a0e9]"
      />
    </div>
  );
}

export function AdminFilter({
  value,
  onChange,
  allLabel,
  options,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          "h-9 w-full rounded-sm border-border bg-card text-foreground sm:w-[200px]",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type AdminRowAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "default" | "warning" | "success" | "danger";
  disabled?: boolean;
};

export function RowActions({
  actions,
  id,
}: {
  actions: AdminRowAction[];
  /** When set, a Copy ID item is appended after a separator. */
  id?: string;
}) {
  const copyId = async () => {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      toast.success("ID copied");
    } catch {
      toast.error("Could not copy the ID");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Row actions"
          className="size-8 cursor-pointer rounded-full"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onClick={action.onSelect}
            disabled={action.disabled}
            className={cn(
              "cursor-pointer",
              action.tone === "warning" && "text-orange-500",
              action.tone === "success" && "text-emerald-600",
              action.tone === "danger" && "text-destructive",
            )}
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
        {id ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={copyId} className="cursor-pointer">
              <Copy className="mr-2 size-4" />
              Copy ID
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ADMIN_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function parseAdminDate(value: string | Date): Date | null {
  const date =
    value instanceof Date
      ? value
      : new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function DateCell({
  value,
}: {
  value: string | Date | null | undefined;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const date = parseAdminDate(value);
  if (!date) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="type-meta text-muted-foreground">
      {ADMIN_DATE.format(date)}
    </span>
  );
}

export function EntityChip({
  children,
  tone = "sub",
}: {
  children: ReactNode;
  tone?: "category" | "sub";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 type-body-sm text-black",
        tone === "category" ? "bg-sky-200" : "bg-sky-100",
      )}
    >
      {children}
    </span>
  );
}

export function ChipList({
  items,
  max = 3,
  tone = "sub",
  empty = "—",
}: {
  items: string[];
  max?: number;
  tone?: "category" | "sub";
  empty?: string;
}) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  const shown = items.slice(0, max);
  const hidden = items.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((item, index) => (
        <EntityChip key={`${item}-${index}`} tone={tone}>
          {item}
        </EntityChip>
      ))}
      {hidden > 0 ? (
        <span
          className="type-meta text-muted-foreground"
          title={items.join(", ")}
        >
          +{hidden}
        </span>
      ) : null}
    </div>
  );
}

/** Thumbnail + name + a muted second line — the catalogue tables' first cell. */
export function PrimaryCell({
  image,
  alt,
  title,
  subtitle,
  imageClassName,
  shape = "square",
}: {
  image?: string | null;
  alt: string;
  title: ReactNode;
  subtitle?: ReactNode;
  imageClassName?: string;
  /** People read better in a circle; catalogue rows keep the square tile. */
  shape?: "square" | "round";
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center overflow-hidden border border-border bg-muted/40",
          shape === "round" ? "rounded-full" : "rounded-md",
        )}
      >
        <DbImage
          src={image ?? ""}
          alt={alt}
          width={40}
          height={40}
          className={cn("size-10 object-cover", imageClassName)}
          fallback={
            <span className="type-nav text-muted-foreground">
              {alt.charAt(0).toUpperCase()}
            </span>
          }
        />
      </div>
      <div className="min-w-0">
        <div className="font-medium leading-tight">{title}</div>
        {subtitle ? (
          <div className="type-meta leading-tight text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
