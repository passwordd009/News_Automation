import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppSidebar } from "@/components/navigation/AppSidebar";
import { getAuthState } from "@/lib/auth/getCurrentProfile";
import { can, capabilityForPath } from "@/lib/auth/permissions";
import { AccountSetupNotice } from "@/components/navigation/AccountSetupNotice";

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
  const state = await getAuthState();

  if (state.status === "anonymous") redirect("/login");

  // Signed in with no profile row. Redirecting to /login here would loop: the
  // proxy sees a valid session and sends them straight back. Explain instead.
  if (state.status === "no-profile") {
    return <AccountSetupNotice email={state.email} userId={state.userId} />;
  }

  const profile = state.user;
  const pathname = (await headers()).get("x-pathname") ?? "";
  const capability = capabilityForPath(pathname);

  if (capability && !can(profile.role, capability)) {
    redirect("/dashboard?denied=1");
  }

  return (
    <div className="flex min-h-screen flex-col sm:block">
      <AppSidebar role={profile.role} email={profile.email} />
      {/* Matches the fixed sidebar's width so the content starts beside it
          rather than beneath it. Below `sm` the sidebar is in flow and this
          offset does not apply. */}
      <div className="min-w-0 flex-1 sm:ml-56">{children}</div>
    </div>
  );
}
