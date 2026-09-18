import { Suspense } from "react";
import { AuthPageShell, FormSkeleton } from "@/components/auth/AuthPageShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata = { title: "Choose a password · Project Hestia" };

export default function ResetPasswordPage() {
  return (
    <AuthPageShell
      title="Choose a password"
      subtitle="You are setting the password for your account"
    >
      {/* The form reads `?error=` from a failed exchange, which opts it out of
          prerendering — so it sits behind its own boundary. */}
      <Suspense fallback={<FormSkeleton />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthPageShell>
  );
}
