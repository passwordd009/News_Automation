import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every matched route: refreshes the Supabase session and turns
 * signed-out visitors away before a page renders.
 *
 * Named `proxy`, not `middleware` — the middleware convention is deprecated in
 * Next.js 16 and renamed to proxy.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
