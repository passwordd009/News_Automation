import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Running the collector from the dashboard.
 *
 * No configuration required: if the worker is sitting next to the web app —
 * which it is in this repository — the button works. `ENABLE_LOCAL_INGEST=false`
 * turns it off for a deployment where the dashboard is hosted away from the
 * worker and the feature would only ever fail.
 */

const MAX_LIMIT = 50;
const TIMEOUT_MS = 20 * 60 * 1000;

export function repoRoot(): string {
  // web/ sits one level below the repository root.
  return path.resolve(process.cwd(), "..");
}

export function scriptPath(): string {
  return process.env.INGEST_SCRIPT || path.join(repoRoot(), "worker", "scripts", "ingest.py");
}

/**
 * Where Python is, checked in order of how specific the answer is.
 *
 * The bare names at the end are resolved through PATH by execFile; if none of
 * them exist the run fails with ENOENT, which the caller turns into a readable
 * message rather than a stack trace.
 */
export function pythonCandidates(): string[] {
  const configured = process.env.INGEST_PYTHON;
  if (configured) return [configured];

  const root = repoRoot();
  return [
    path.join(root, ".venv", "bin", "python"), // unix virtualenv
    path.join(root, ".venv", "Scripts", "python.exe"), // windows virtualenv
    path.join(root, "venv", "bin", "python"),
    "python3",
    "python",
  ];
}

export function resolvePython(): string {
  // An explicit setting always wins, even if the file is not there: silently
  // substituting python3 would hide the typo, where using it fails with an
  // error naming the exact path that was configured.
  const configured = process.env.INGEST_PYTHON;
  if (configured) return configured;

  const onDisk = pythonCandidates().find(
    (candidate) => candidate.includes(path.sep) && existsSync(candidate),
  );

  // Otherwise let execFile resolve it on PATH.
  return onDisk ?? "python3";
}

/** Whether to offer the button at all. */
export function workerAvailable(): boolean {
  if (process.env.ENABLE_LOCAL_INGEST === "false") return false;
  return existsSync(scriptPath());
}

export interface WorkerRun {
  ok: boolean;
  summary: string | null;
  output: string;
  error?: string;
  durationMs: number;
}

// One run at a time. Two concurrent collections would duplicate every fetch,
// race on the same inserts, and double the model's work for nothing.
let inFlight: Promise<WorkerRun> | null = null;

export function isRunning(): boolean {
  return inFlight !== null;
}

export async function runWorker(
  limit?: number | null,
  forDate?: string | null,
): Promise<WorkerRun> {
  if (inFlight) return inFlight;

  inFlight = execute(limit, forDate).finally(() => {
    inFlight = null;
  }) as Promise<WorkerRun>;

  return inFlight;
}

/** A day the worker will accept: YYYY-MM-DD and nothing else. */
export function validateDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new RangeError("date must be YYYY-MM-DD.");
  }
  return text;
}

export function validateLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new RangeError(`limit must be a whole number between 1 and ${MAX_LIMIT}.`);
  }
  return parsed;
}

async function execute(limit?: number | null, forDate?: string | null): Promise<WorkerRun> {
  const started = Date.now();
  const script = scriptPath();

  if (!existsSync(script)) {
    return {
      ok: false,
      summary: null,
      output: "",
      error: `The worker script is missing at ${script}.`,
      durationMs: 0,
    };
  }

  // Fixed argument array — nothing from the request is ever interpolated into
  // a command line, and the only caller value is a validated integer.
  const args = [script];
  if (limit) args.push("--limit", String(limit));
  if (forDate) args.push("--for-date", forDate);

  const python = resolvePython();

  try {
    const { stdout, stderr } = await run(python, args, {
      cwd: repoRoot(),
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    return {
      ok: true,
      summary: summarize(stdout),
      output: tail(stdout) || tail(stderr),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    return {
      ok: false,
      summary: null,
      output: tail(err.stdout),
      error: explain(err, python),
      durationMs: Date.now() - started,
    };
  }
}

function explain(
  err: NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean },
  python: string,
): string {
  if (err.code === "ENOENT") {
    return (
      `Python was not found (tried ${python}). Create the virtualenv at the ` +
      "repository root, or set INGEST_PYTHON in web/.env.local to the interpreter path."
    );
  }

  if (err.killed) {
    return "The run took too long and was stopped.";
  }

  // The worker exits with a readable message of its own — a missing model, or
  // Supabase credentials. Pass that through instead of a generic failure.
  const message = extractWorkerError(err.stderr) ?? extractWorkerError(err.stdout);
  return message ?? "The worker exited with an error.";
}

function summarize(stdout: string): string | null {
  return (
    stdout
      .split("\n")
      .reverse()
      .find((line) => line.includes("Fetched:") && line.includes("Inserted:"))
      ?.trim() ?? null
  );
}

function tail(text?: string, lines = 60): string {
  if (!text) return "";
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

// "02:41:34 WARNING app.llm.client | ..." — the worker's own logging format.
const LOG_LINE = /^\d{2}:\d{2}:\d{2}\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s/;

/**
 * The message a person should read.
 *
 * The worker prints a marked "✗" block explaining what to do; its logger also
 * writes to stderr, and the first line there is usually a stack-shaped
 * connection error that tells a reviewer nothing. Prefer the deliberate
 * message, and fall back to the first line that is not log noise.
 */
function extractWorkerError(text?: string): string | null {
  if (!text) return null;

  const lines = text.split("\n").map((line) => line.trimEnd());

  const marked = lines.findIndex((line) => line.trimStart().startsWith("✗"));
  if (marked !== -1) {
    // Keep the continuation lines up to the blank line that closes the block:
    // that is where the fix is spelled out, and they are not always indented.
    const block = [lines[marked].replace(/^\s*✗\s*/, "")];
    for (let i = marked + 1; i < lines.length; i += 1) {
      const next = lines[i];
      if (!next.trim() || LOG_LINE.test(next.trim())) break;
      block.push(next.trim());
    }
    return block.join("\n");
  }

  return (
    lines
      .map((line) => line.trim())
      .filter(Boolean)
      .find(
        (line) =>
          !LOG_LINE.test(line) &&
          !line.startsWith("Traceback") &&
          !line.startsWith("File \"") &&
          !/^\^+$/.test(line),
      ) ?? null
  );
}
