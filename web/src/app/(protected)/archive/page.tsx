import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getArchiveMonths } from "@/lib/articles/queries";
import { formatPeriodRange } from "@/lib/format";

export const metadata = { title: "Archive · Project Hestia" };

/**
 * Past weeks, grouped by month.
 *
 * Only the index lives here — opening a week reuses the same feed component
 * /approved renders, because §13 is explicit that the archive does not get a
 * design of its own. A week is a week, whether it went out last Monday or in
 * March.
 */
export default async function ArchivePage() {
  const profile = await requireProfile();
  if (!can(profile.role, "viewArchive")) redirect("/dashboard?denied=1");

  const { months, error } = await getArchiveMonths();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="border-l-4 border-accent pl-4">
        <h1 className="text-xs font-semibold uppercase tracking-widest text-accent">
          Archive
        </h1>
        <p className="mt-1 text-2xl font-semibold tracking-tight">Past weeks</p>
      </header>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-negative/40 bg-negative/5 px-4 py-3"
        >
          <p className="text-sm font-medium text-negative">The archive could not be read</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{error}</p>
        </div>
      )}

      {!error && months.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
          Nothing archived yet. A week appears here once it has approved stories in it.
        </div>
      )}

      <div className="mt-10 space-y-12">
        {months.map((month) => (
          <section key={month.key}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
              {month.label}
            </h2>

            <ol className="mt-4 space-y-3">
              {month.weeks.map(({ period, count }) => (
                <li key={period.id}>
                  <Link
                    href={`/archive/${period.id}`}
                    className="block rounded-lg border border-border bg-surface px-5 py-4 text-center transition hover:border-accent"
                  >
                    <p className="text-base font-semibold tracking-tight">
                      {count} post{count === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {formatPeriodRange(period.start_date, period.end_date)}
                    </p>
                    {period.status === "active" && (
                      <p className="mt-1 text-xs uppercase tracking-wider text-accent">
                        This week
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
