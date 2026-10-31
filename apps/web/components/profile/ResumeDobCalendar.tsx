"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  addDays,
  addMonths,
  addYears,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { MONTH_LABELS, WEEKDAY_LABELS } from "@/lib/locale-labels";

/**
 * The resume DOB calendar: a days view ⇄ months view toggled by the middle of
 * the header. ‹ / › step the month (or the year while the months are shown);
 * the middle wraps "January 2011" in one control — clicking it swaps the day
 * grid for the year's months, and picking a month returns to the days.
 * Navigation clamps to the allowed range; days outside it are inert.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const NAV_BUTTON =
  "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-muted disabled:pointer-events-none disabled:text-gray-300";

export function ResumeDobCalendar({
  selected,
  from,
  to,
  onSelect,
}: {
  selected: Date | null;
  from: Date;
  to: Date;
  onSelect: (date: Date) => void;
}) {
  const t = useTranslations("Resume");
  const locale = useLocale();
  const [view, setView] = useState<"days" | "months">("days");
  const [cursor, setCursor] = useState<Date>(selected ?? new Date(2000, 0, 1));

  const year = cursor.getFullYear();
  const weekdays = WEEKDAY_LABELS[locale] ?? WEEKDAYS;
  const monthLabels = locale === "km" ? MONTH_LABELS.km : MONTHS;
  const monthTitle =
    locale === "km"
      ? `${MONTH_LABELS.km[cursor.getMonth()]} ${year}`
      : format(cursor, "MMMM yyyy");
  const canPrevMonth = startOfMonth(cursor) > startOfMonth(from);
  const canNextMonth = startOfMonth(cursor) < startOfMonth(to);
  const canPrevYear = year > from.getFullYear();
  const canNextYear = year < to.getFullYear();

  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="w-[340px] p-4">
      <div className="flex items-center">
        <button
          type="button"
          aria-label={
            view === "days" ? t("form.previousMonth") : t("form.previousYear")
          }
          disabled={view === "days" ? !canPrevMonth : !canPrevYear}
          onClick={() =>
            setCursor((c) =>
              view === "days" ? addMonths(c, -1) : addYears(c, -1),
            )
          }
          className={NAV_BUTTON}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        {view === "days" ? (
          <button
            type="button"
            onClick={() => setView("months")}
            className="h-10 min-w-0 flex-1 cursor-pointer rounded-md text-center type-nav text-foreground transition-colors hover:bg-muted"
          >
            {monthTitle}
          </button>
        ) : (
          <span className="flex h-10 flex-1 items-center justify-center type-nav text-foreground">
            {format(cursor, "yyyy")}
          </span>
        )}
        <button
          type="button"
          aria-label={
            view === "days" ? t("form.nextMonth") : t("form.nextYear")
          }
          disabled={view === "days" ? !canNextMonth : !canNextYear}
          onClick={() =>
            setCursor((c) =>
              view === "days" ? addMonths(c, 1) : addYears(c, 1),
            )
          }
          className={NAV_BUTTON}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {view === "days" ? (
        <>
          <div className="mt-3 grid grid-cols-7">
            {weekdays.map((day) => (
              <span
                key={day}
                className="flex h-9 items-center justify-center type-nav text-foreground"
              >
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const outside = !isSameMonth(day, cursor);
              const outOfRange = day < from || day > to;
              const isSelected = selected !== null && isSameDay(day, selected);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={outside || outOfRange}
                  onClick={() => onSelect(day)}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-md type-body-sm transition-colors",
                    isSelected
                      ? "bg-[#00a0e9] font-medium text-white"
                      : outside || outOfRange
                        ? "cursor-default text-gray-300"
                        : "cursor-pointer text-foreground hover:bg-muted",
                  )}
                >
                  {format(day, "dd")}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-y-1">
          {monthLabels.map((label, month) => {
            const isCursorMonth = month === cursor.getMonth();
            const outOfRange =
              (year === from.getFullYear() && month < from.getMonth()) ||
              (year === to.getFullYear() && month > to.getMonth());
            return (
              <button
                key={label}
                type="button"
                disabled={outOfRange}
                onClick={() => {
                  setCursor(new Date(year, month, 1));
                  setView("days");
                }}
                className={cn(
                  "flex h-9 cursor-pointer items-center justify-center rounded-md type-body-sm transition-colors",
                  isCursorMonth
                    ? "bg-[#00a0e9] font-medium text-white"
                    : outOfRange
                      ? "cursor-default text-gray-300"
                      : "text-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
