import { HestiaLogo } from "@/components/brand/HestiaLogo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * The frame around every signed-out page.
 *
 * A server component, so the mark and heading are in the first response and
 * the page is never blank while JavaScript loads. Only the forms inside are
 * client components, and only they suspend.
 */
export function AuthPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <HestiaLogo size={96} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>

        {children}

        <div className="mt-6 flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </main>
  );
}

/** Holds a form's shape so the layout does not jump when it arrives. */
export function FormSkeleton() {
  return (
    <div
      aria-hidden
      className="rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <div className="mb-4 h-4 w-12 rounded bg-border" />
      <div className="mb-5 h-9 w-full rounded-md bg-border/60" />
      <div className="mb-4 h-4 w-20 rounded bg-border" />
      <div className="h-9 w-full rounded-md bg-border/60" />
      <div className="mt-5 h-9 w-full rounded-md bg-border" />
    </div>
  );
}
