/**
 * Is the screening model there?
 *
 * The collect button runs the worker with `--review auto`, which screens when
 * the model is reachable and collects without it when it is not. That is the
 * right behaviour — a click should always produce articles — but on its own it
 * is indistinguishable from screening that ran and liked nothing. Asking
 * Ollama directly lets the page say which of the two you are looking at,
 * before you click rather than after.
 *
 * This talks to Ollama's HTTP API rather than shelling out to the worker:
 * spawning Python to answer "is a port open" would cost a second per page
 * render for an answer a single GET already gives.
 */

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.2:3b";

// A page render must not wait on a hung daemon. Ollama answers /api/tags from
// memory, so anything slower than this is not going to serve a model either.
const PROBE_TIMEOUT_MS = 1500;

// Re-probing on every render would add a round trip to each navigation, and
// the answer only changes when someone starts or stops a daemon.
const CACHE_MS = 30_000;

export interface ModelStatus {
  /** The daemon answered. */
  reachable: boolean;
  /** The daemon answered *and* the configured model is pulled. */
  ready: boolean;
  model: string;
  url: string;
  /** What to do about it, when there is something to do. */
  hint?: string;
}

export function modelUrl(): string {
  return (process.env.OLLAMA_URL || DEFAULT_URL).replace(/\/+$/, "");
}

export function modelName(): string {
  return process.env.OLLAMA_MODEL || DEFAULT_MODEL;
}

/**
 * Whether `wanted` appears in the list Ollama reports.
 *
 * Tags come back fully qualified ("llama3.2:3b", "llama3.1:latest") but may be
 * configured bare, so compare the base name when either side omits a tag.
 * Mirrors OllamaClient.is_available() in the worker deliberately: two answers
 * to "is the model pulled" that disagree would be worse than none.
 */
export function modelMatches(wanted: string, available: string[]): boolean {
  const base = (name: string) => name.split(":")[0];
  return available.some((name) => name === wanted || base(name) === base(wanted));
}

let cached: { at: number; status: ModelStatus } | null = null;

/** Exposed for tests, which must not inherit a previous case's probe. */
export function resetModelStatusCache(): void {
  cached = null;
}

export async function getModelStatus(now = Date.now()): Promise<ModelStatus> {
  if (cached && now - cached.at < CACHE_MS) return cached.status;

  const status = await probe();
  cached = { at: now, status };
  return status;
}

async function probe(): Promise<ModelStatus> {
  const url = modelUrl();
  const model = modelName();
  const local = /(localhost|127\.0\.0\.1|\[::1\])/.test(url);

  try {
    const response = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        reachable: false,
        ready: false,
        model,
        url,
        hint:
          response.status === 401 || response.status === 403
            ? "The model host rejected the request — check OLLAMA_AUTH_TOKEN."
            : `The model host answered ${response.status}.`,
      };
    }

    const body = (await response.json()) as { models?: { name?: string }[] };
    const available = (body.models ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name));

    if (modelMatches(model, available)) {
      return { reachable: true, ready: true, model, url };
    }

    return {
      reachable: true,
      ready: false,
      model,
      url,
      hint: `Ollama is running but ${model} is not pulled. Run: ollama pull ${model}`,
    };
  } catch {
    return {
      reachable: false,
      ready: false,
      model,
      url,
      hint: local
        ? `Ollama is not running. Install it from ollama.com, then: ollama pull ${model}`
        : `No answer from ${url}. Check the host is up and reachable from here.`,
    };
  }
}
