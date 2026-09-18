import { describe, expect, it } from "vitest";
import { joinName, splitName } from "./name";

describe("joinName", () => {
  it("joins the two halves", () => {
    expect(joinName("Elijah", "Hawes")).toBe("Elijah Hawes");
  });

  it("does not leave a trailing space when half is missing", () => {
    expect(joinName("Cher", "")).toBe("Cher");
    expect(joinName("", "Hawes")).toBe("Hawes");
  });

  it("stores nothing rather than an empty string", () => {
    expect(joinName("", "")).toBeNull();
    expect(joinName("   ", "  ")).toBeNull();
  });

  it("trims what people paste", () => {
    expect(joinName("  Elijah ", " Hawes  ")).toBe("Elijah Hawes");
  });
});

describe("splitName", () => {
  it("splits at the last space, so middle names stay with the first", () => {
    expect(splitName("Ada King Lovelace")).toEqual({ first: "Ada King", last: "Lovelace" });
  });

  it("treats a single word as a first name", () => {
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
  });

  it("handles no name at all", () => {
    expect(splitName(null)).toEqual({ first: "", last: "" });
    expect(splitName("")).toEqual({ first: "", last: "" });
    expect(splitName("   ")).toEqual({ first: "", last: "" });
  });

  it("round-trips through joinName", () => {
    for (const name of ["Elijah Hawes", "Cher", "Ada King Lovelace"]) {
      const { first, last } = splitName(name);
      expect(joinName(first, last)).toBe(name);
    }
  });
});
