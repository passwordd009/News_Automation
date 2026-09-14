import { Suspense } from "react";
import { HestiaLogo } from "@/components/brand/HestiaLogo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Sign in · Project Hestia" };

/**
 * A server component, so the mark and heading are in the first response.
 *
 * Only the form suspends — it reads `?next=`, which opts that subtree out of
 * prerendering. Keeping the shell outside the boundary means the page is never
 * blank while JavaScript loads.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <HestiaLogo size={96} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Project Hestia
          </h1>
          <p className="mt-1 text-sm text-muted">
            Weekly Wrap-Up editorial dashboard
          </p>
        </div>

        <Suspense fallback={<FormSkeleton />}>
          <LoginForm />
        </Suspense>

        <div className="mt-6 flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </main>
  );
}

/** Holds the form's shape so the layout does not jump when it arrives. */
function FormSkeleton() {
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
