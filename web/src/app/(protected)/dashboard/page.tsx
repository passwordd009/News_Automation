import Link from "next/link";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { WeeklyPeriod } from "@/types/database";

export const metadata = { title: "Dashboard · Project Hestia" };

function formatRange(period: WeeklyPeriod | null) {
  if (!period) return "No active week";
  const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
  // Dates are plain YYYY-MM-DD; parsing as UTC avoids a timezone off-by-one.
  const start = new Date(`${period.start_date}T00:00:00Z`);
  const end = new Date(`${period.end_date}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
  return `${fmt.format(start)} – ${fmt.format(end)}, ${end.getUTCFullYear()}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const profile = await requireProfile();
  const { denied } = await searchParams;
  const supabase = await createClient();

  const { data: period } = await supabase
    .from("weekly_periods")
    .select("*")
    .eq("status", "active")
    .maybeSingle<WeeklyPeriod>();

  const links = [
    { href: "/review", label: "Review queue", capability: "viewPendingQueue" as const },
    { href: "/approved", label: "Approved this week", capability: "viewApproved" as const },
    { href: "/declined", label: "Declined", capability: "viewDeclined" as const },
    { href: "/archive", label: "Past weeks", capability: "viewArchive" as const },
  ].filter((link) => can(profile.role, link.capability));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {denied && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-accent-border bg-accent-soft px-4 py-3 text-sm text-accent-strong"
        >
          That page is not available to your role.
        </p>
      )}

      <p className="text-sm text-muted">
        Signed in as {profile.fullName || profile.email} · {ROLE_LABELS[profile.role]}
      </p>

      <div className="mt-6 border-l-4 border-accent pl-4">
        <h1 className="text-xs font-semibold uppercase tracking-widest text-accent">
          Weekly Wrap-Up
        </h1>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {formatRange(period ?? null)}
        </p>
      </div>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="block rounded-lg border border-border bg-surface px-4 py-4 text-sm font-medium transition hover:border-accent-border hover:bg-accent-soft"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs leading-relaxed text-muted">
        The AI screens and scores articles. It never approves anything — every
        story in the Wrap-Up is chosen by a person, and nothing is posted
        automatically.
      </p>
    </main>
  );
}
