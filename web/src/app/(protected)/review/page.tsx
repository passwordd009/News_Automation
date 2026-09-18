import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { getActivePeriod } from "@/lib/articles/queries";
import { defaultDay, weekDays } from "@/lib/week";

/**
 * /review has no content of its own — each day is its own page.
 *
 * It picks the day to open and forwards. Keeping the bare path working means a
 * bookmark, the sidebar link and an old ?day= URL all still land somewhere
 * sensible instead of on a blank route.
 */
export default async function ReviewIndex() {
  const profile = await requireProfile();
  if (!can(profile.role, "viewPendingQueue")) redirect("/dashboard?denied=1");

  const period = await getActivePeriod();
  if (!period) redirect("/review/none");

  redirect(`/review/${defaultDay(weekDays(period.start_date))}`);
}
