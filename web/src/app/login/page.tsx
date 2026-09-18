import { Suspense } from "react";
import { AuthPageShell, FormSkeleton } from "@/components/auth/AuthPageShell";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Sign in · Project Hestia" };

export default function LoginPage() {
  return (
    <AuthPageShell title="Project Hestia" subtitle="Weekly Wrap-Up editorial dashboard">
      {/* Only the form suspends — it reads `?next=`, which opts that subtree
          out of prerendering. The shell stays outside the boundary. */}
      <Suspense fallback={<FormSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthPageShell>
  );
}
