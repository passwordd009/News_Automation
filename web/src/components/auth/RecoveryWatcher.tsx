"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const RESET_PATH = "/reset-password";

/**
 * Catches a password-recovery link that landed on the wrong page.
 *
 * Supabase can return a recovery session as a URL *fragment*
 * (`#access_token=…&type=recovery`) rather than a query parameter. A fragment
 * is never sent to the server, so no route handler can see it — and fragments
 * survive redirects, so it rides along through `/` to `/dashboard` to `/login`
 * and quietly establishes a session there. The person is then signed in, on a
 * page that says nothing about passwords, with no idea their link worked.
 *
 * Mounted in the root layout so it runs wherever that lands, and it forwards
 * to the page that can actually finish the job.
 */
export function RecoveryWatcher() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === RESET_PATH) return;

    const supabase = createClient();

    // Fires once the recovery link's session is established, whichever page
    // the Supabase client happened to be constructed on.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") router.replace(RESET_PATH);
    });

    // The event can fire before this mounts, and on a route where no Supabase
    // client is constructed it never fires at all. Reading the fragment covers
    // both — and it is carried across rather than dropped, because the tokens
    // may not have been consumed yet.
    const hash = window.location.hash;
    if (/[#&]type=recovery(&|$)/.test(hash)) {
      router.replace(`${RESET_PATH}${hash}`);
    }

    return () => data.subscription.unsubscribe();
  }, [pathname, router]);

  return null;
}
