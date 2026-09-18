import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DispatchError,
  dispatchAvailable,
  dispatchIngest,
  getRunStatus,
  isRequestId,
  newRequestId,
  readConfig,
  validateDate,
  validateLimit,
} from "./dispatch";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env.GITHUB_DISPATCH_TOKEN = "ghp_test";
  process.env.GITHUB_REPO = "owner/repo";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...OLD_ENV };
});

/** Queue of responses, consumed in order, with the requests recorded. */
function mockGithub(responses: { status: number; body?: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(index++, responses.length - 1)];
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body ?? {},
        text: async () => JSON.stringify(next.body ?? {}),
      };
    }),
  );

  return calls;
}

const RUNS = (requestId: string, id = 42) => ({
  workflow_runs: [
    { id: 7, display_title: "Collect latest [otherrun0001]", html_url: "u7" },
    { id, display_title: `Collect for 2026-09-14 [${requestId}]`, html_url: `https://gh/runs/${id}` },
  ],
});

describe("configuration", () => {
  it("is unavailable without a token", () => {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    expect(dispatchAvailable()).toBe(false);
    expect(readConfig()).toBeNull();
  });

  it("is available with one", () => {
    expect(dispatchAvailable()).toBe(true);
  });

  it("rejects a repo that is not owner/name, since it goes into a URL path", () => {
    process.env.GITHUB_REPO = "owner/repo/../../evil";
    expect(readConfig()).toBeNull();
  });
});

describe("input validation", () => {
  it("accepts a well-formed day and rejects anything else", () => {
    expect(validateDate("2026-09-14")).toBe("2026-09-14");
    expect(validateDate(undefined)).toBeNull();
    expect(() => validateDate("14/09/2026")).toThrow(RangeError);
    expect(() => validateDate("2026-13-45")).toThrow(RangeError);
  });

  it("bounds the limit", () => {
    expect(validateLimit("10")).toBe(10);
    expect(validateLimit(null)).toBeNull();
    expect(() => validateLimit(0)).toThrow(RangeError);
    expect(() => validateLimit(9999)).toThrow(RangeError);
    expect(() => validateLimit("ten")).toThrow(RangeError);
  });

  it("round-trips its own request ids and rejects foreign ones", () => {
    const id = newRequestId();
    expect(isRequestId(id)).toBe(true);
    expect(isRequestId("../../etc/passwd")).toBe(false);
    expect(isRequestId("")).toBe(false);
  });
});

describe("dispatchIngest", () => {
  it("posts to the workflow and finds the run by its request id", async () => {
    const calls = mockGithub([
      { status: 204 },
      { status: 200, body: RUNS("PLACEHOLDER") },
    ]);

    // The request id is generated inside, so echo whatever was sent.
    vi.mocked(fetch).mockImplementation(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/dispatches")) {
        return { ok: true, status: 204, json: async () => ({}), text: async () => "" } as never;
      }
      const sent = JSON.parse(String(calls[0].init?.body)) as { inputs: { request_id: string } };
      return {
        ok: true,
        status: 200,
        json: async () => RUNS(sent.inputs.request_id),
        text: async () => "",
      } as never;
    });

    const handle = await dispatchIngest({ date: "2026-09-14", limit: 5 });

    const body = JSON.parse(String(calls[0].init?.body));
    expect(calls[0].url).toContain("/repos/owner/repo/actions/workflows/ingest.yml/dispatches");
    expect(body.inputs).toMatchObject({ limit: "5", date: "2026-09-14" });
    expect(handle.runId).toBe(42);
    expect(handle.url).toBe("https://gh/runs/42");
  });

  it("pins the ref server-side rather than taking it from the caller", async () => {
    const calls = mockGithub([{ status: 204 }, { status: 200, body: { workflow_runs: [] } }]);
    await dispatchIngest({});
    expect(JSON.parse(String(calls[0].init?.body)).ref).toBe("main");
  });

  it("sends empty strings, not nulls, for absent inputs", async () => {
    const calls = mockGithub([{ status: 204 }, { status: 200, body: { workflow_runs: [] } }]);
    await dispatchIngest({});
    const inputs = JSON.parse(String(calls[0].init?.body)).inputs;
    expect(inputs.limit).toBe("");
    expect(inputs.date).toBe("");
  });

  it("returns a handle with no run id when GitHub has not listed it yet", async () => {
    mockGithub([{ status: 204 }, { status: 200, body: { workflow_runs: [] } }]);
    const handle = await dispatchIngest({});
    expect(handle.runId).toBeNull();
    expect(isRequestId(handle.requestId)).toBe(true);
  });

  it("names the missing permission on a 403 instead of echoing the status", async () => {
    mockGithub([{ status: 403, body: { message: "Resource not accessible" } }]);
    await expect(dispatchIngest({})).rejects.toThrow(/Actions.*Read and write/);
  });

  it("says the token is bad on a 401", async () => {
    mockGithub([{ status: 401 }]);
    await expect(dispatchIngest({})).rejects.toThrow(/expired or been revoked/);
  });

  it("refuses to dispatch at all when unconfigured", async () => {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    await expect(dispatchIngest({})).rejects.toBeInstanceOf(DispatchError);
  });
});

describe("getRunStatus", () => {
  const ID = "abc123def456";

  it("reports queued while the run is not yet listed", async () => {
    mockGithub([{ status: 200, body: { workflow_runs: [] } }]);
    expect(await getRunStatus(ID)).toMatchObject({ state: "queued", runId: null });
  });

  it("reports running once it is in progress", async () => {
    mockGithub([{ status: 200, body: { status: "in_progress", html_url: "https://gh/runs/42" } }]);
    expect(await getRunStatus(ID, 42)).toMatchObject({ state: "running", runId: 42 });
  });

  it("reports success", async () => {
    mockGithub([{ status: 200, body: { status: "completed", conclusion: "success" } }]);
    expect(await getRunStatus(ID, 42)).toMatchObject({ state: "succeeded" });
  });

  it("explains a failure in terms of the required screening", async () => {
    mockGithub([{ status: 200, body: { status: "completed", conclusion: "failure" } }]);
    const status = await getRunStatus(ID, 42);
    expect(status.state).toBe("failed");
    expect(status.detail).toContain("Screening is required");
  });

  it("distinguishes a cancelled run from a failed one", async () => {
    mockGithub([{ status: 200, body: { status: "completed", conclusion: "cancelled" } }]);
    expect(await getRunStatus(ID, 42)).toMatchObject({ state: "cancelled" });
  });

  it("skips the search when the run id is already known", async () => {
    const calls = mockGithub([
      { status: 200, body: { status: "completed", conclusion: "success" } },
    ]);
    await getRunStatus(ID, 42);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/actions/runs/42");
  });
});
