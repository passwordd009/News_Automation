import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  pythonCandidates,
  repoRoot,
  resolvePython,
  scriptPath,
  validateLimit,
  workerAvailable,
} from "./localWorker";

afterEach(() => vi.unstubAllEnvs());

describe("finding the worker", () => {
  it("looks for it beside the web app", () => {
    expect(scriptPath()).toBe(path.join(repoRoot(), "worker", "scripts", "ingest.py"));
  });

  it("actually finds it in this repository", () => {
    // If this fails the button would silently not appear, which is exactly the
    // failure being guarded against.
    expect(existsSync(scriptPath())).toBe(true);
    expect(workerAvailable()).toBe(true);
  });

  it("honours an explicit script path", () => {
    vi.stubEnv("INGEST_SCRIPT", "/somewhere/else/ingest.py");
    expect(scriptPath()).toBe("/somewhere/else/ingest.py");
  });

  it("can be switched off where the worker is not installed", () => {
    vi.stubEnv("ENABLE_LOCAL_INGEST", "false");
    expect(workerAvailable()).toBe(false);
  });

  it("is on without any configuration", () => {
    vi.stubEnv("ENABLE_LOCAL_INGEST", "");
    expect(workerAvailable()).toBe(true);
  });
});

describe("finding python", () => {
  it("prefers the project virtualenv, then falls back to PATH", () => {
    const candidates = pythonCandidates();
    expect(candidates[0]).toBe(path.join(repoRoot(), ".venv", "bin", "python"));
    expect(candidates).toContain("python3");
  });

  it("uses an explicit interpreter when given one", () => {
    vi.stubEnv("INGEST_PYTHON", "/usr/local/bin/python3.12");
    expect(pythonCandidates()).toEqual(["/usr/local/bin/python3.12"]);
    expect(resolvePython()).toBe("/usr/local/bin/python3.12");
  });

  it("resolves to something runnable", () => {
    const python = resolvePython();
    expect(python.length).toBeGreaterThan(0);
    // Either a real file, or a bare name for execFile to find on PATH.
    expect(existsSync(python) || !python.includes(path.sep)).toBe(true);
  });
});

describe("the limit argument", () => {
  it("accepts nothing", () => {
    expect(validateLimit(undefined)).toBeNull();
    expect(validateLimit(null)).toBeNull();
    expect(validateLimit("")).toBeNull();
  });

  it("accepts a small whole number", () => {
    expect(validateLimit(5)).toBe(5);
    expect(validateLimit("10")).toBe(10);
    expect(validateLimit(50)).toBe(50);
  });

  it("rejects anything that is not one", () => {
    // Nothing here should ever reach a command line, but the type is the
    // guarantee that it cannot.
    for (const bad of [0, -1, 51, 1.5, "abc", "5; rm -rf /", "--help", {}, []]) {
      expect(() => validateLimit(bad), String(bad)).toThrow();
    }
  });
});
