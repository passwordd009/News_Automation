import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getPendingCountsByDay, getReviewQueue } from "@/lib/articles/queries";
import { ReviewArticleCard } from "@/components/articles/ReviewArticleCard";
import { DayActions } from "@/components/articles/DayActions";
import { WeekDayTabs } from "@/components/weekly/WeekDayTabs";
import { formatPeriodRange } from "@/lib/format";
import { defaultDay, isValidDay, weekDays } from "@/lib/week";
import { dispatchAvailable } from "@/lib/worker/dispatch";

export const metadata = { title: "Review · Project Hestia" };

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  // Checked here as well as in the layout: a page should not depend on a
  // parent's guard for its own authorization.
  const profile = await requireProfile();
  if (!can(profile.role, "viewPendingQueue")) redirect("/dashboard?denied=1");

  const { day: requestedDay } = await searchParams;
  const { period } = await getReviewQueue();

  // Without an open week there is no set of days to show.
  if (!period) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">No active week</h1>
        <p className="mt-2 text-sm text-muted">
          Collect articles to open one, or run{" "}
          <code>python worker/scripts/rotate_week.py</code>.
        </p>
      </main>
    );
  }

  const days = weekDays(period.start_date);
  // A day that has not happened cannot be opened, whatever the URL says.
  const selected = isValidDay(requestedDay, days) ? requestedDay : defaultDay(days);
  const selectedDay = days.find((d) => d.date === selected)!;

  const collectConfigured = dispatchAvailable();

  const [{ articles }, counts] = await Promise.all([
    getReviewQueue(selected),
    getPendingCountsByDay(days.filter((d) => !d.isFuture).map((d) => d.date)),
  ]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-l-4 border-accent pl-4">
        <h1 className="text-xs font-semibold uppercase tracking-widest text-accent">
          Review queue
        </h1>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {formatPeriodRange(period.start_date, period.end_date)}
        </p>
        <p className="mt-1 text-sm text-muted">
          {total === 0
            ? "Nothing waiting this week."
            : `${total} article${total === 1 ? "" : "s"} awaiting a decision this week`}
        </p>
      </header>

      <WeekDayTabs days={days} selected={selected} counts={counts} />

      <DayActions
        day={selected}
        label={selectedDay.label}
        pendingCount={articles.length}
        collectConfigured={collectConfigured}
        canClear={profile.role === "admin"}
      />

      {articles.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium">Nothing from {selectedDay.label}.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {`Collect ${selectedDay.label}'s news above. Feeds only carry their recent entries, so a day that has scrolled off the end of every feed may return nothing.`}
          </p>
        </div>
      ) : (
        <>
          <ol className="mt-8 space-y-5">
            {articles.map((article) => (
              <li key={article.id}>
                <ReviewArticleCard article={article} />
              </li>
            ))}
          </ol>

          <p className="mt-10 text-xs leading-relaxed text-muted">
            {selectedDay.label}&apos;s articles, sorted with reconsiderations
            first, then the AI&apos;s recommendations, then by score. Everything
            collected is listed — low-scoring stories sink to the bottom rather
            than being hidden, so the decision stays yours.
          </p>
        </>
      )}
    </main>
  );
}
