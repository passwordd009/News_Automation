import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata = { title: "Reset your password · Project Hestia" };

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      title="Reset your password"
      subtitle="We will email you a link to set a new one"
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
