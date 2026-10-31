"use client";

import * as React from "react";
import {
  addDays,
  addMonths,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { MONTH_LABELS, WEEKDAY_LABELS } from "@/lib/locale-labels";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The edit-profile birthday picker, matching the mock: a days grid whose month
 * and year headers drill into a months grid and a scrollable years grid, a
 * calendar icon returns to the days, and Close/Save commit the staged pick.
 * The field shows `Oct 05, 2005` and carries a red minus to clear the value.
 */

const NAV_BUTTON =
  "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-muted disabled:pointer-events-none disabled:text-gray-300";
const GRID_CELL =
  "flex h-9 cursor-pointer items-center justify-center rounded-md type-body-sm transition-colors";
const GRID_CELL_MUTED = "cursor-default text-gray-300";

export function DateOfBirthPicker({
  id,
  value,
  onChange,
  from,
  to,
  defaultMonth,
  placeholder,
}: {
  id?: string;
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  from?: Date;
  to?: Date;
  /** Where to open when no value is set (e.g. a legacy year-only account). */
  defaultMonth?: Date;
  placeholder?: string;
}) {
  const t = useTranslations("Common");
  const locale = useLocale();
  const monthLabels = MONTH_LABELS[locale] ?? MONTH_LABELS.en;
  const weekdayLabels = WEEKDAY_LABELS[locale] ?? WEEKDAY_LABELS.en;
  const resolvedPlaceholder = placeholder ?? t("selectDateOfBirth");
  const minDate = React.useMemo(() => from ?? new Date(1900, 0, 1), [from]);
  const maxDate = React.useMemo(() => to ?? new Date(), [to]);
  const fallbackMonth = defaultMonth ?? new Date(2000, 0, 1);

  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<"days" | "months" | "years">("days");
  const [cursor, setCursor] = React.useState<Date>(
    () => value ?? fallbackMonth,
  );
  // Staged until Save; Close discards it and leaves the field untouched.
  const [staged, setStaged] = React.useState<Date | undefined>(value);
  const selectedYearRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (view === "years") {
      selectedYearRef.current?.scrollIntoView({ block: "center" });
    }
  }, [view]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setStaged(value);
      setCursor(value ?? fallbackMonth);
      setView("days");
    }
    setOpen(next);
  };

  const year = cursor.getFullYear();
  const canPrevMonth = startOfMonth(cursor) > startOfMonth(minDate);
  const canNextMonth = startOfMonth(cursor) < startOfMonth(maxDate);

  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const years: number[] = [];
  for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y++)
    years.push(y);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            className="flex h-9 w-full cursor-pointer items-center rounded-sm border border-input bg-transparent px-2.5 pr-10 text-left type-body transition-colors outline-none focus-visible:border-[#00a0e9] focus-visible:ring-1 focus-visible:ring-[#00a0e9]"
          >
            {value ? (
              `${monthLabels[value.getMonth()]} ${String(
                value.getDate(),
              ).padStart(2, "0")}, ${value.getFullYear()}`
            ) : (
              <span className="text-muted-foreground">
                {resolvedPlaceholder}
              </span>
            )}
          </button>
        </PopoverTrigger>

        {/* Empty → dropdown affordance; with a value the red ⊖ takes its
            place (both sit in the same right-hand slot). */}
        {!value && (
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
        )}

        <PopoverContent align="start" className="w-[320px] p-3">
          {view === "days" && (
            <>
              <div className="flex items-center">
                <button
                  type="button"
                  aria-label={t("previousMonth")}
                  disabled={!canPrevMonth}
                  onClick={() => setCursor((c) => addMonths(c, -1))}
                  className={NAV_BUTTON}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex flex-1 items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => setView("months")}
                    className="h-9 cursor-pointer rounded-md px-3 type-nav text-foreground transition-colors hover:bg-muted"
                  >
                    {monthLabels[cursor.getMonth()]}
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("years")}
                    className="h-9 cursor-pointer rounded-md px-3 type-nav text-foreground transition-colors hover:bg-muted"
                  >
                    {year}
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={t("nextMonth")}
                  disabled={!canNextMonth}
                  onClick={() => setCursor((c) => addMonths(c, 1))}
                  className={NAV_BUTTON}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-7">
                {weekdayLabels.map((day) => (
                  <span
                    key={day}
                    className="flex h-8 items-center justify-center type-meta text-foreground"
                  >
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const outside = !isSameMonth(day, cursor);
                  const outOfRange = day < minDate || day > maxDate;
                  const isSelected =
                    staged !== undefined && isSameDay(day, staged);
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      disabled={outside || outOfRange}
                      onClick={() => setStaged(day)}
                      className={cn(
                        GRID_CELL,
                        isSelected
                          ? "bg-[#00a0e9] font-medium text-white"
                          : outside || outOfRange
                            ? GRID_CELL_MUTED
                            : "text-foreground hover:bg-muted",
                      )}
                    >
                      {String(day.getDate()).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === "months" && (
            <>
              <div className="grid grid-cols-3 gap-1">
                {monthLabels.map((label, month) => {
                  const isCursorMonth = month === cursor.getMonth();
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setCursor(new Date(year, month, 1));
                        setView("days");
                      }}
                      className={cn(
                        "flex h-10 cursor-pointer items-center justify-center rounded-md type-body-sm transition-colors",
                        isCursorMonth
                          ? "bg-[#00a0e9] font-medium text-white"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <BackToDays onClick={() => setView("days")} />
            </>
          )}

          {view === "years" && (
            <>
              <div className="max-h-60 overflow-y-auto">
                <div className="grid grid-cols-3 gap-1">
                  {years.map((y) => (
                    <button
                      key={y}
                      ref={y === year ? selectedYearRef : undefined}
                      type="button"
                      onClick={() => {
                        setCursor(new Date(y, cursor.getMonth(), 1));
                        setView("months");
                      }}
                      className={cn(
                        "flex h-10 cursor-pointer items-center justify-center rounded-md type-body-sm transition-colors",
                        y === year
                          ? "bg-[#00a0e9] font-medium text-white"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              <BackToDays onClick={() => setView("days")} />
            </>
          )}

          <div className="mt-2 flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 cursor-pointer rounded-md bg-muted px-5 type-nav text-foreground transition-colors hover:bg-muted/70"
            >
              {t("close")}
            </button>
            <button
              type="button"
              disabled={!staged}
              onClick={() => {
                if (staged) onChange(staged);
                setOpen(false);
              }}
              className="h-9 cursor-pointer rounded-md bg-[#00a0e9] px-5 type-nav text-white transition-colors hover:bg-[#0090d0] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("save")}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {value && (
        <button
          type="button"
          aria-label={t("clearDateOfBirth")}
          onClick={() => onChange(undefined)}
          className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-red-500 text-red-500 transition-colors hover:bg-red-50"
        >
          <Minus className="h-4 w-4" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

function BackToDays({ onClick }: { onClick: () => void }) {
  const t = useTranslations("Common");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("backToCalendar")}
      className="mt-2 flex w-full cursor-pointer items-center justify-center py-2 text-gray-500 transition-colors hover:text-gray-700"
    >
      <CalendarDays className="h-5 w-5" />
    </button>
  );
}
