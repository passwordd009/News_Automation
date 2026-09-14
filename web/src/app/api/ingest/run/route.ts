import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { getCurrentProfile } from "@/lib/auth/getCurrentProfile";
import { can } from "@/lib/auth/permissions";

const run = promisify(execFile);

// child_process is not available on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs the ingestion worker from the dashboard.
 *
 * This executes a local process, so it is gated deliberately and narrowly:
 *
 *  1. OFF unless ENABLE_LOCAL_INGEST=true. It is a development convenience for
 *     running the worker on the same machine as the dashboard, not a feature
 *     of a deployed app — a hosted Next.js server has no Python worker beside
 *     it, and exposing process execution on a public host is a bad trade.
 *  2. Reviewers only, checked server-side.
 *  3. execFile with an argument array, never a shell string, and the only
 *     caller-supplied value is a limit that must parse as a small integer.
 *     Nothing from the request reaches a command line as text.
 */

const MAX_LIMIT = 50;
const TIMEOUT_MS = 15 * 60 * 1000;

function repoRoot(): string {
  // web/ sits one level below the repository root.
  return path.resolve(process.cwd(), "..");
}

function pythonPath(): string {
  return process.env.INGEST_PYTHON || path.join(repoRoot(), ".venv", "bin", "python");
}

function scriptPath(): string {
  return process.env.INGEST_SCRIPT || path.join(repoRoot(), "worker", "scripts", "ingest.py");
}

export async function POST(request: Request) {
  if (process.env.ENABLE_LOCAL_INGEST !== "true") {
    return NextResponse.json(
      {
        error:
          "Running the worker from the dashboard is disabled. Set ENABLE_LOCAL_INGEST=true " +
          "in web/.env.local to enable it — only do this when the worker lives on the same " +
          "machine as the dashboard.",
      },
      { status: 403 },
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }
  if (!can(profile.role, "viewPendingQueue")) {
    return NextResponse.json(
      { error: "Your role cannot run the collector." },
      { status: 403 },
    );
  }

  // The only caller-controlled value, and it must be a small integer.
  let limit: number | null = null;
  try {
    const body = await request.json();
    if (body?.limit !== undefined && body.limit !== null) {
      const parsed = Number(body.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return NextResponse.json(
          { error: `limit must be a whole number between 1 and ${MAX_LIMIT}.` },
          { status: 400 },
        );
      }
      limit = parsed;
    }
  } catch {
    // No body is fine — run without a limit.
  }

  const args = [scriptPath()];
  if (limit !== null) args.push("--limit", String(limit));

  const started = Date.now();

  try {
    const { stdout, stderr } = await run(pythonPath(), args, {
      cwd: repoRoot(),
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      summary: summarize(stdout),
      output: tail(stdout),
      warnings: tail(stderr),
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    if (err.code === "ENOENT") {
      return NextResponse.json(
        {
          error:
            `Could not find the Python interpreter at ${pythonPath()}. ` +
            "Create the virtualenv, or set INGEST_PYTHON in web/.env.local.",
        },
        { status: 500 },
      );
    }

    if (err.killed) {
      return NextResponse.json(
        { error: "The run took too long and was stopped.", output: tail(err.stdout) },
        { status: 504 },
      );
    }

    // The worker exits non-zero with a readable message (model down, Supabase
    // unreachable). Pass that through rather than a generic failure.
    return NextResponse.json(
      {
        error: firstLine(err.stderr) || "The worker exited with an error.",
        output: tail(err.stdout),
        warnings: tail(err.stderr),
      },
      { status: 500 },
    );
  }
}

/** The worker's own one-line stats, if it got that far. */
function summarize(stdout: string): string | null {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.includes("Fetched:") && l.includes("Inserted:"));
  return line?.trim() ?? null;
}

function tail(text?: string, lines = 40): string {
  if (!text) return "";
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

function firstLine(text?: string): string | null {
  if (!text) return null;
  return text.trim().split("\n").find((l) => l.trim().length > 0)?.trim() ?? null;
}
