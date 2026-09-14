import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getApprovedWeek } from "@/lib/articles/queries";
import { WeeklyArticleList } from "@/components/weekly/WeeklyArticleList";

export const metadata = { title: "Approved · Project Hestia" };

export default async function ApprovedPage() {
  const profile = await requireProfile();
  if (!can(profile.role, "viewApproved")) redirect("/dashboard?denied=1");

  const { period, articles } = await getApprovedWeek();

  return (
    <main>
      <WeeklyArticleList
        period={period}
        articles={articles}
        emptyMessage={
          can(profile.role, "approveArticle") ? (
            <>
              Nothing approved yet. Work through the{" "}
              <a href="/review" className="underline underline-offset-4 hover:text-accent">
                review queue
              </a>{" "}
              and approved stories will appear here.
            </>
          ) : (
            "Nothing approved yet this week. Check back once the editors have been through the queue."
          )
        }
      />
    </main>
  );
}
