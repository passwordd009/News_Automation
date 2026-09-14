import { formatPeriodRange } from "@/lib/format";
import type { WeeklyPeriod } from "@/types/database";

/**
 * The week, made prominent (§13). A content creator opening this page should
 * know which Wrap-Up they are looking at before reading anything else.
 */
export function WeeklyPeriodHeader({
  period,
  count,
}: {
  period: WeeklyPeriod | null;
  count: number;
}) {
  return (
    <header className="border-b-2 border-accent pb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        Weekly Wrap-Up
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {period ? formatPeriodRange(period.start_date, period.end_date) : "No week open"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {count === 0
          ? "Nothing approved yet."
          : `${count} approved ${count === 1 ? "story" : "stories"}`}
        {period?.status === "closed" && " · this week is closed"}
      </p>
    </header>
  );
}
