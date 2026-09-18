import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import {
  DispatchError,
  dispatchAvailable,
  dispatchIngest,
  getRunStatus,
  isRequestId,
  validateDate,
  validateLimit,
} from "@/lib/worker/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts a collection, and reports on one already started.
 *
 * POST asks GitHub Actions to run the ingest workflow and returns a handle to
 * watch; GET reports where that run has got to. The work happens on a runner
 * with the model installed, so a dashboard collection is screened on exactly
 * the same terms as the nightly one.
 *
 * Authorization is checked on both: a reviewer may start runs, nobody else.
 */

function notPermitted(profile: Awaited<ReturnType<typeof getCurrentProfile>>) {
  if (!profile) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }
  if (!can(profile.role, "viewPendingQueue")) {
    return NextResponse.json({ error: "Your role cannot collect articles." }, { status: 403 });
  }
  return null;
}

const NOT_CONFIGURED =
  "Collecting from the dashboard is not configured. GITHUB_DISPATCH_TOKEN must be set " +
  'to a fine-grained token whose "Actions" permission is Read and write.';

export async function POST(request: Request) {
  const denied = notPermitted(await getCurrentProfile());
  if (denied) return denied;

  if (!dispatchAvailable()) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  let limit: number | null;
  let date: string | null;
  try {
    const body = await request.json().catch(() => ({}));
    limit = validateLimit(body?.limit);
    date = validateDate(body?.date);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  try {
    const handle = await dispatchIngest({ limit, date });
    return NextResponse.json(handle, { status: 202 });
  } catch (error) {
    if (error instanceof DispatchError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Could not reach GitHub to start the run." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const denied = notPermitted(await getCurrentProfile());
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const requestId = params.get("requestId");

  // No run named: the page is only asking whether the button should exist.
  if (!requestId) {
    return NextResponse.json({ available: dispatchAvailable() });
  }

  if (!isRequestId(requestId)) {
    return NextResponse.json({ error: "Unknown run." }, { status: 400 });
  }

  if (!dispatchAvailable()) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  const rawRunId = params.get("runId");
  const runId = rawRunId && /^\d+$/.test(rawRunId) ? Number(rawRunId) : null;

  try {
    return NextResponse.json(await getRunStatus(requestId, runId));
  } catch (error) {
    if (error instanceof DispatchError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Could not reach GitHub." }, { status: 502 });
  }
}
