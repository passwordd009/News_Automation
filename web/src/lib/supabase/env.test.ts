import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseEnv } from "./env";

/**
 * Supabase renamed anon -> publishable. A project created after the rename
 * shows only the new name, so reading the old one alone leaves the app
 * unconfigured with no clear signal about why.
 */

afterEach(() => vi.unstubAllEnvs());

function stub(vars: Record<string, string | undefined>) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", vars.url ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", vars.publishable ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", vars.anon ?? "");
}

describe("getSupabaseEnv", () => {
  it("accepts the current publishable key name", () => {
    stub({ url: "https://x.supabase.co", publishable: "sb_publishable_abc" });
    expect(getSupabaseEnv()).toEqual({
      url: "https://x.supabase.co",
      key: "sb_publishable_abc",
    });
  });

  it("still accepts the legacy anon key name", () => {
    stub({ url: "https://x.supabase.co", anon: "legacy-anon" });
    expect(getSupabaseEnv().key).toBe("legacy-anon");
  });

  it("prefers the current name when both are set", () => {
    stub({ url: "https://x.supabase.co", publishable: "new", anon: "old" });
    expect(getSupabaseEnv().key).toBe("new");
  });

  it("treats blank values as missing", () => {
    stub({ url: "https://x.supabase.co", publishable: "   ", anon: "old" });
    expect(getSupabaseEnv().key).toBe("old");
  });

  it("names what is missing rather than failing obscurely", () => {
    stub({ url: "https://x.supabase.co" });
    expect(() => getSupabaseEnv()).toThrow(/PUBLISHABLE_KEY/);

    stub({ publishable: "key" });
    expect(() => getSupabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
