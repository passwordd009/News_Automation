import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getModelStatus,
  modelMatches,
  modelName,
  modelUrl,
  resetModelStatusCache,
} from "./modelStatus";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  resetModelStatusCache();
  delete process.env.OLLAMA_URL;
  delete process.env.OLLAMA_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...OLD_ENV };
});

function respondWith(models: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: models.map((name) => ({ name })) }),
    })),
  );
}

describe("modelMatches", () => {
  it("accepts an exact tag", () => {
    expect(modelMatches("llama3.2:3b", ["llama3.2:3b"])).toBe(true);
  });

  it("accepts a bare name against a tagged one, and the reverse", () => {
    expect(modelMatches("llama3.1", ["llama3.1:latest"])).toBe(true);
    expect(modelMatches("llama3.1:latest", ["llama3.1"])).toBe(true);
  });

  it("rejects a different model", () => {
    expect(modelMatches("llama3.2:3b", ["mistral:latest", "gemma:2b"])).toBe(false);
  });

  it("rejects an empty list", () => {
    expect(modelMatches("llama3.2:3b", [])).toBe(false);
  });
});

describe("configuration", () => {
  it("defaults to local Ollama and the model CI pulls", () => {
    expect(modelUrl()).toBe("http://127.0.0.1:11434");
    expect(modelName()).toBe("llama3.2:3b");
  });

  it("strips a trailing slash so the probe URL is not doubled", () => {
    process.env.OLLAMA_URL = "https://models.example.com/";
    expect(modelUrl()).toBe("https://models.example.com");
  });
});

describe("getModelStatus", () => {
  it("is ready when the daemon answers and the model is pulled", async () => {
    respondWith(["llama3.2:3b"]);
    const status = await getModelStatus();
    expect(status).toMatchObject({ reachable: true, ready: true, model: "llama3.2:3b" });
    expect(status.hint).toBeUndefined();
  });

  it("is reachable but not ready when the model is missing, and says how to pull it", async () => {
    respondWith(["mistral:latest"]);
    const status = await getModelStatus();
    expect(status.reachable).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.hint).toContain("ollama pull llama3.2:3b");
  });

  it("reports a local daemon that is not running, with an install hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const status = await getModelStatus();
    expect(status).toMatchObject({ reachable: false, ready: false });
    expect(status.hint).toContain("ollama.com");
  });

  it("blames credentials, not the network, on a 403 from a hosted instance", async () => {
    process.env.OLLAMA_URL = "https://models.example.com";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));

    const status = await getModelStatus();
    expect(status.reachable).toBe(false);
    expect(status.hint).toContain("OLLAMA_AUTH_TOKEN");
  });

  it("does not tell you to install Ollama when the model is on another host", async () => {
    process.env.OLLAMA_URL = "https://models.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ETIMEDOUT");
      }),
    );

    const status = await getModelStatus();
    expect(status.hint).not.toContain("ollama.com");
    expect(status.hint).toContain("models.example.com");
  });

  it("caches, so a page render does not re-probe on every navigation", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "llama3.2:3b" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await getModelStatus(1_000);
    await getModelStatus(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // ...but a daemon started since the last probe is picked up.
    await getModelStatus(1_000 + 31_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
