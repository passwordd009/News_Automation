import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session.
 *
 * The redirect is relative for the same reason the auth callback's are: behind
 * a reverse proxy, `request.url` in a route handler carries the address the
 * server is bound to internally, not the one the browser used. Building an
 * absolute URL from it sent people to the container's own host.
 */
export async function POST(request: NextRequest) {
  void request;
  const supabase = await createClient();
  await supabase.auth.signOut();

  return new Response(null, { status: 303, headers: { Location: "/login" } });
}
