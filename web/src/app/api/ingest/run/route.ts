import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";
import { isRunning, runWorker, validateLimit, workerAvailable } from "@/lib/worker/localWorker";

// child_process is not available on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Collects and screens articles on demand.
 *
 * Runs the worker beside the app rather than asking anyone to open a terminal.
 * Two things still gate it: only reviewers may start a run, and only one run
 * happens at a time.
 */
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }
  if (!can(profile.role, "viewPendingQueue")) {
    return NextResponse.json({ error: "Your role cannot collect articles." }, { status: 403 });
  }

  if (!workerAvailable()) {
    return NextResponse.json(
      {
        error:
          "The collector is not available here. It runs the worker next to the dashboard, " +
          "so it only works where both are installed together.",
      },
      { status: 503 },
    );
  }

  if (isRunning()) {
    return NextResponse.json(
      { error: "A collection is already running. Wait for it to finish." },
      { status: 409 },
    );
  }

  let limit: number | null;
  try {
    const body = await request.json().catch(() => ({}));
    limit = validateLimit(body?.limit);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const result = await runWorker(limit);

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

/** Lets the page ask whether a run is in progress. */
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || !can(profile.role, "viewPendingQueue")) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  return NextResponse.json({ available: workerAvailable(), running: isRunning() });
}
