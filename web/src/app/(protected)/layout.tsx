import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppSidebar } from "@/components/navigation/AppSidebar";
import { requireProfile } from "@/lib/auth/getCurrentProfile";
import { can, capabilityForPath } from "@/lib/auth/permissions";

/**
 * Server-side guard for every protected route.
 *
 * §16: "Do not expose routes merely by hiding links." The sidebar filters
 * itself for tidiness; this decides. And even this is only the second of three
 * layers — RLS is what actually protects the data.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  const pathname = (await headers()).get("x-pathname") ?? "";
  const capability = capabilityForPath(pathname);

  if (capability && !can(profile.role, capability)) {
    redirect("/dashboard?denied=1");
  }

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <AppSidebar role={profile.role} email={profile.email} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
