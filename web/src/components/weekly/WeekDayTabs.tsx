import Link from "next/link";
import type { DayCounts } from "@/lib/articles/queries";
import type { WeekDay } from "@/lib/week";

/**
 * The seven days of the editorial week.
 *
 * Days that have not arrived are rendered as plain text, not links — there is
 * nothing to show and nothing to collect, so a disabled-looking button that
 * still responds to a click would be a lie.
 *
 * A day with an AI recommendation on it is marked, so a day worth opening is
 * visible without opening every day to find out.
 */
export function WeekDayTabs({
  days,
  selected,
  counts,
}: {
  days: WeekDay[];
  selected: string;
  counts: DayCounts;
}) {
  return (
    <nav aria-label="Days of the week" className="mt-6">
      <ol className="flex flex-wrap gap-1 border-b border-border">
        {days.map((day) => {
          const active = day.date === selected;
          const count = counts.pending[day.date] ?? 0;
          const recommended = counts.recommended[day.date] ?? 0;

          if (day.isFuture) {
            return (
              <li key={day.date}>
                <span
                  aria-disabled="true"
                  title={`${day.label} has not happened yet`}
                  className="block cursor-not-allowed px-3 py-2 text-sm text-muted/50 select-none"
                >
                  {day.short}
                </span>
              </li>
            );
          }

          return (
            <li key={day.date}>
              <Link
                href={`/review?day=${day.date}`}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition -mb-px",
                  active
                    ? "border-accent font-semibold text-accent-strong"
                    : "border-transparent text-foreground hover:border-accent-border hover:text-accent-strong",
                ].join(" ")}
              >
                <span>{day.short}</span>
                {day.isToday && (
                  <span className="text-[10px] uppercase tracking-wider text-muted">today</span>
                )}
                {count > 0 && (
                  <span
                    className={[
                      "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                      active ? "bg-accent text-white" : "bg-border text-muted",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                )}
                {recommended > 0 && (
                  <span
                    title={`${recommended} AI-recommended on ${day.label}`}
                    className="text-xs text-accent"
                  >
                    ★{recommended}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
