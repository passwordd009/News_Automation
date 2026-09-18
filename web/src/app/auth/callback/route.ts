import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

/**
 * Where the link in an authentication email lands.
 *
 * It accepts both shapes Supabase can send, because they fail in different
 * situations and the choice is made in the email template rather than here:
 *
 * `?code=` is the PKCE flow, which `@supabase/ssr` pins its clients to. The
 * exchange needs a code verifier that library stored in a cookie — readable
 * here on the server, which is why this is a route handler and not a client
 * component. The catch is that the cookie lives in the browser that *asked*
 * for the link, so asking on a laptop and opening the mail on a phone cannot
 * work.
 *
 * `?token_hash=&type=` is the OTP flow, which carries no verifier and so works
 * from any device. It requires the email template to send `{{ .TokenHash }}`
 * rather than the default `{{ .ConfirmationURL }}` — see docs/DEPLOYMENT.md.
 *
 * Handling both means the template can change without a deploy, and a link
 * already sitting in someone's inbox keeps working either way.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  // Never trusted: this arrives from a link someone else may have composed.
  const next = safeNext(searchParams.get("next"));

  // Supabase reports a refused or expired link here rather than by failing the
  // exchange, so check before spending a round trip on it.
  const error = searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      failed(origin, searchParams.get("error_description") ?? error),
    );
  }

  const supabase = await createClient();

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error: otpError } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (otpError) return NextResponse.redirect(failed(origin, otpError.message));
    return NextResponse.redirect(new URL(next, origin));
  }

  const code = searchParams.get("code");
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return NextResponse.redirect(failed(origin, exchangeError.message));
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(failed(origin, "That link is incomplete."));
}

/**
 * Supabase's own wording, where a person can act on it.
 *
 * The PKCE verifier message is the one that matters: it says "storage was
 * cleared" in library terms, when what actually happened is almost always that
 * the link was opened on a different device from the one that asked for it.
 * Someone reading the raw text has no reason to try their laptop instead.
 */
function explain(reason: string): string {
  if (/code verifier/i.test(reason)) {
    return (
      "This link has to be opened in the same browser that asked for it. " +
      "If you requested it on another device, open it there — or send yourself " +
      "a fresh link from this one."
    );
  }
  if (/expired|invalid|already/i.test(reason)) {
    return "This link has expired or was already used. Links last an hour and work once.";
  }
  return reason;
}

/**
 * Send a failure somewhere that can explain it.
 *
 * `/reset-password` handles a missing session by offering another link, which
 * is what someone with a stale email actually needs — better than `/login`,
 * where a dead recovery link looks like a wrong password.
 */
function failed(origin: string, reason: string): URL {
  const url = new URL("/reset-password", origin);
  url.searchParams.set("error", explain(reason));
  return url;
}
