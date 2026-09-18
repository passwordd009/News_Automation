import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getApprovedWeek } from "@/lib/articles/queries";
import { WeeklyArticleList } from "@/components/weekly/WeeklyArticleList";

export const metadata = { title: "Archived week · Project Hestia" };

/** One archived week, rendered exactly as /approved renders the current one. */
export default async function ArchivedWeekPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const profile = await requireProfile();
  if (!can(profile.role, "viewArchive")) redirect("/dashboard?denied=1");

  const { periodId } = await params;
  const { period, articles } = await getApprovedWeek(periodId);
  if (!period) notFound();

  return (
    <main>
      <div className="mx-auto max-w-2xl px-6 pt-10">
        <Link
          href="/archive"
          className="text-xs text-muted underline underline-offset-4 transition hover:text-accent"
        >
          ← All weeks
        </Link>
      </div>

      <WeeklyArticleList
        period={period}
        articles={articles}
        canReturn={can(profile.role, "approveArticle")}
        emptyMessage="Nothing was approved for this week."
      />
    </main>
  );
}
