import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Refreshes the auth session on every request and bounces signed-out users.
 *
 * Called from `src/proxy.ts` (Next.js 16 renamed the middleware convention to
 * proxy). Route protection also happens in the protected layout; this is the
 * cheap first gate so an unauthenticated request never reaches a page at all.
 */
export async function updateSession(request: NextRequest) {
  // The protected layout needs to know which route is being rendered in order
  // to check it against the role matrix. Server Components cannot read the URL,
  // so pass it down as a request header.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const env = getSupabaseEnv();
  const supabase = createServerClient(
    env.url,
    env.key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase. getSession() only reads the
  // cookie, which the client could have tampered with.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/auth");
  const isApi = pathname.startsWith("/api/");

  if (!user && !isPublic) {
    // Redirecting an API call to an HTML login page gives fetch() a 307 and
    // then a page of HTML, so the caller fails on JSON.parse and reports
    // something unrelated. Answer machines with a status code.
    if (isApi) {
      return NextResponse.json(
        { error: "You are not signed in." },
        { status: 401 },
      );
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    // Come back here once they have signed in.
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
