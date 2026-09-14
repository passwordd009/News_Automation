"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, ROLE_LABELS, type Capability, type Role } from "@/lib/auth/permissions";
import { HestiaLogo } from "@/components/brand/HestiaLogo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

interface NavItem {
  href: string;
  label: string;
  capability: Capability;
}

const NAV: NavItem[] = [
  { href: "/review", label: "Review", capability: "viewPendingQueue" },
  { href: "/approved", label: "Approved", capability: "viewApproved" },
  { href: "/declined", label: "Declined", capability: "viewDeclined" },
  { href: "/archive", label: "Archive", capability: "viewArchive" },
  { href: "/admin/users", label: "Users", capability: "manageUserRoles" },
];

export function AppSidebar({
  role,
  email,
}: {
  role: Role;
  email: string | null;
}) {
  const pathname = usePathname();

  // Navigation is filtered for clarity, not for security: the layout guard and
  // Supabase RLS both refuse the route regardless of what is rendered here.
  const items = NAV.filter((item) => can(role, item.capability));

  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 flex-col gap-1 border-b border-border bg-surface px-4 py-4 sm:w-56 sm:border-r sm:border-b-0 sm:px-3 sm:py-6"
    >
      <div className="mb-4 flex items-center gap-3 px-2">
        <HestiaLogo size={36} />
        <div>
          <p className="text-sm font-semibold leading-tight">Project Hestia</p>
          <p className="text-xs text-muted">Weekly Wrap-Up</p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-1 sm:flex-col">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "block rounded-md px-3 py-2 text-sm transition",
                  active
                    ? "border-l-2 border-accent bg-accent-soft font-medium text-accent-strong sm:border-l-2"
                    : "text-foreground hover:bg-accent-soft hover:text-accent-strong",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto hidden border-t border-border px-2 pt-4 sm:block">
        <p className="truncate text-xs text-muted" title={email ?? undefined}>
          {email}
        </p>
        <p className="mt-0.5 text-xs font-medium text-accent">{ROLE_LABELS[role]}</p>
        <div className="mt-3">
          <ThemeToggle />
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-3 text-xs text-muted underline underline-offset-4 hover:text-accent"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
