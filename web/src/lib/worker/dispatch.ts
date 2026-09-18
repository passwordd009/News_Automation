import "server-only";

/**
 * Collecting by asking GitHub Actions to do it.
 *
 * The dashboard used to spawn `python worker/scripts/ingest.py` as a child
 * process. That only ever worked where the worker sat on the same disk, which
 * a deployed dashboard never does — no Python, no worker directory, and no
 * model. So the button now dispatches the workflow that already exists and
 * watches it run.
 *
 * What this buys, beyond working in production: the run happens in the same
 * environment as the nightly schedule, with `--review require`, so a collection
 * started by hand is screened exactly like an automatic one. There is no longer
 * a path that quietly files a day unscored.
 *
 * What it costs: a click no longer returns results. It returns a run to watch.
 */

const WORKFLOW_FILE = "ingest.yml";
const API = "https://api.github.com";

/**
 * The branch runs are dispatched from, fixed server-side.
 *
 * Never taken from the request. The workflow executes with the Supabase secret
 * key in its environment, so being able to choose the ref would mean being able
 * to choose the code that reads it.
 */
const REF = process.env.GITHUB_DISPATCH_REF || "main";

const DEFAULT_REPO = "passwordd009/News_Automation";

export interface DispatchConfig {
  token: string;
  repo: string;
}

export function readConfig(): DispatchConfig | null {
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) return null;

  const repo = (process.env.GITHUB_REPO || DEFAULT_REPO).trim();
  // owner/name, nothing else — this goes straight into a URL path.
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;

  return { token, repo };
}

/** Whether to offer the button at all. */
export function dispatchAvailable(): boolean {
  return readConfig() !== null;
}

export type RunState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RunHandle {
  requestId: string;
  /** Null while GitHub has accepted the dispatch but not yet listed the run. */
  runId: number | null;
  url: string | null;
}

export interface RunStatus {
  state: RunState;
  runId: number | null;
  url: string | null;
  /** Present once the run finishes; the dashboard shows it verbatim. */
  detail?: string;
}

export class DispatchError extends Error {}

/** A day the worker will accept: YYYY-MM-DD and nothing else. */
export function validateDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new RangeError("date must be YYYY-MM-DD.");
  }
  return text;
}

const MAX_LIMIT = 50;

export function validateLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new RangeError(`limit must be a whole number between 1 and ${MAX_LIMIT}.`);
  }
  return parsed;
}

/** Opaque, short, and safe to put in a run name and a URL query. */
export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{12}$/.test(value);
}

async function github(
  config: DispatchConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

/**
 * Turn GitHub's status codes into something worth reading.
 *
 * The token's permissions are the most likely thing to be wrong, and "403" on
 * its own sends someone to the wrong place.
 */
async function explain(response: Response, repo: string): Promise<string> {
  const body = await response.text().catch(() => "");
  const message = (() => {
    try {
      return (JSON.parse(body) as { message?: string }).message;
    } catch {
      return undefined;
    }
  })();

  switch (response.status) {
    case 401:
      return "GitHub rejected the token. It may have expired or been revoked — issue a new one and update GITHUB_DISPATCH_TOKEN.";
    case 403:
      return `The token cannot start workflows on ${repo}. It needs the "Actions" repository permission set to Read and write.`;
    case 404:
      return `Could not find ${WORKFLOW_FILE} in ${repo}. Check GITHUB_REPO, and that the token can see this repository.`;
    case 422:
      return `GitHub refused the run: ${message ?? "unprocessable"}. Usually the branch (${REF}) does not exist, or the workflow on it has no workflow_dispatch trigger.`;
    default:
      return `GitHub returned ${response.status}${message ? `: ${message}` : ""}.`;
  }
}

/**
 * Ask GitHub to start a collection.
 *
 * The dispatch endpoint answers 204 with an empty body — no run id — so the
 * run has to be located afterwards by the request id stamped into its name.
 * It usually appears within a second or two, but not always, and a caller that
 * gets no id is expected to keep polling rather than treat it as a failure.
 */
export async function dispatchIngest(options: {
  limit?: number | null;
  date?: string | null;
}): Promise<RunHandle> {
  const config = readConfig();
  if (!config) {
    throw new DispatchError(
      "Collecting from the dashboard is not configured. Set GITHUB_DISPATCH_TOKEN to a " +
        'fine-grained token with the "Actions" permission set to Read and write.',
    );
  }

  const requestId = newRequestId();

  const response = await github(
    config,
    `/repos/${config.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: REF,
        inputs: {
          // Workflow inputs are strings; an absent value must be "" not null.
          limit: options.limit ? String(options.limit) : "",
          date: options.date ?? "",
          request_id: requestId,
        },
      }),
    },
  );

  if (!response.ok) throw new DispatchError(await explain(response, config.repo));

  const found = await findRun(config, requestId);
  return { requestId, runId: found?.runId ?? null, url: found?.url ?? null };
}

/** Locate the run carrying `requestId` in its name. */
async function findRun(
  config: DispatchConfig,
  requestId: string,
): Promise<{ runId: number; url: string } | null> {
  const response = await github(
    config,
    `/repos/${config.repo}/actions/workflows/${WORKFLOW_FILE}/runs` +
      `?event=workflow_dispatch&per_page=20`,
  );
  if (!response.ok) return null;

  const body = (await response.json()) as {
    workflow_runs?: {
      id: number;
      name?: string;
      display_title?: string;
      html_url: string;
    }[];
  };

  // run-name lands in display_title, and in name on some responses. Check both
  // rather than depending on which one GitHub fills for this event.
  const match = body.workflow_runs?.find(
    (run) =>
      run.display_title?.includes(requestId) || run.name?.includes(requestId),
  );

  return match ? { runId: match.id, url: match.html_url } : null;
}

/**
 * Where a dispatched run has got to.
 *
 * Takes the request id rather than a run id so it still works when the run had
 * not been listed yet at dispatch time — the common case for the first poll.
 */
export async function getRunStatus(
  requestId: string,
  knownRunId?: number | null,
): Promise<RunStatus> {
  const config = readConfig();
  if (!config) throw new DispatchError("Collecting from the dashboard is not configured.");

  let runId = knownRunId ?? null;
  let url: string | null = null;

  if (!runId) {
    const found = await findRun(config, requestId);
    if (!found) {
      // Accepted by GitHub, not yet visible in the runs list.
      return { state: "queued", runId: null, url: null };
    }
    runId = found.runId;
    url = found.url;
  }

  const response = await github(config, `/repos/${config.repo}/actions/runs/${runId}`);
  if (!response.ok) throw new DispatchError(await explain(response, config.repo));

  const run = (await response.json()) as {
    status?: string;
    conclusion?: string | null;
    html_url?: string;
  };

  url = run.html_url ?? url;

  if (run.status !== "completed") {
    return {
      state: run.status === "queued" || run.status === "pending" ? "queued" : "running",
      runId,
      url,
    };
  }

  switch (run.conclusion) {
    case "success":
      return { state: "succeeded", runId, url };
    case "cancelled":
      return { state: "cancelled", runId, url, detail: "The run was cancelled." };
    default:
      return {
        state: "failed",
        runId,
        url,
        detail:
          run.conclusion === "failure"
            ? "The run failed. Screening is required for scheduled and dashboard runs, so a model that would not start stops the whole collection — open the run to see why."
            : `The run ended as ${run.conclusion ?? "unknown"}.`,
      };
  }
}
