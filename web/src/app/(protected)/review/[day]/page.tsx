import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getPendingCountsByDay, getReviewQueue } from "@/lib/articles/queries";
import { ReviewArticleCard } from "@/components/articles/ReviewArticleCard";
import { DayActions } from "@/components/articles/DayActions";
import { WeekDayTabs } from "@/components/weekly/WeekDayTabs";
import { formatPeriodRange } from "@/lib/format";
import { isValidDay, newsroomToday, weekDays } from "@/lib/week";
import { dispatchAvailable } from "@/lib/worker/dispatch";

export const metadata = { title: "Review · Project Hestia" };

/**
 * One day of the editorial week, as its own page.
 *
 * Each day is a route rather than a query parameter, so a day is linkable,
 * bookmarkable, and goes in the browser's history — clicking through the week
 * and pressing back does what it looks like it does.
 */
export default async function ReviewDayPage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const profile = await requireProfile();
  if (!can(profile.role, "viewPendingQueue")) redirect("/dashboard?denied=1");

  const { day: requestedDay } = await params;
  const { period } = await getReviewQueue();

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

  // A day outside this week, or one that has not happened, is not a page.
  if (!isValidDay(requestedDay, days)) notFound();
  const selectedDay = days.find((d) => d.date === requestedDay)!;

  const collectConfigured = dispatchAvailable();

  const [queue, counts] = await Promise.all([
    getReviewQueue(requestedDay),
    getPendingCountsByDay(days.filter((d) => !d.isFuture).map((d) => d.date)),
  ]);

  const { articles } = queue;
  const total = Object.values(counts.pending).reduce((sum, n) => sum + n, 0);
  const recommendedThisWeek = Object.values(counts.recommended).reduce((sum, n) => sum + n, 0);

  const failure = queue.error ?? counts.error;

  const recommended = articles.filter((article) => article.ai_recommended);
  const rest = articles.filter((article) => !article.ai_recommended);

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
          {failure
            ? "The queue could not be read."
            : total === 0
              ? "Nothing waiting this week."
              : `${total} article${total === 1 ? "" : "s"} awaiting a decision this week` +
                (recommendedThisWeek > 0 ? ` · ${recommendedThisWeek} AI-recommended` : "")}
        </p>
      </header>

      {failure && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-negative/40 bg-negative/5 px-4 py-3"
        >
          <p className="text-sm font-medium text-negative">The queue could not be read</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{failure}</p>
        </div>
      )}

      <WeekDayTabs days={days} selected={requestedDay} counts={counts} />

      <DayActions
        day={requestedDay}
        label={selectedDay.label}
        pendingCount={articles.length}
        isToday={requestedDay === newsroomToday()}
        collectConfigured={collectConfigured}
        canClear={profile.role === "admin"}
      />

      {articles.length === 0 ? (
        !failure && (
          <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm font-medium">Nothing from {selectedDay.label}.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              {requestedDay === newsroomToday()
                ? "Collect today's news above. Feeds only carry their recent entries, so a day that has scrolled off the end of every feed may return nothing."
                : "This day was never collected, or everything from it has been decided."}
            </p>
          </div>
        )
      ) : (
        <>
          {recommended.length > 0 && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
                Recommended
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] tabular-nums text-white">
                  {recommended.length}
                </span>
              </h2>
              <p className="mt-1 text-xs text-muted">
                What the AI would put in the post. You still decide.
              </p>
              <ol className="mt-4 space-y-5">
                {recommended.map((article) => (
                  <li key={article.id}>
                    <ReviewArticleCard article={article} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {rest.length > 0 && (
            <section className="mt-10">
              {recommended.length > 0 && (
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Everything else from {selectedDay.label}
                </h2>
              )}
              <ol className="mt-4 space-y-5">
                {rest.map((article) => (
                  <li key={article.id}>
                    <ReviewArticleCard article={article} />
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}
