import { describe, expect, it } from "vitest";
import { pageNumbers, resolvePage } from "./Pagination";

describe("pageNumbers", () => {
  it("lists every page while they fit", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("elides the middle when there are many", () => {
    expect(pageNumbers(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
  });

  it("keeps the row steady near the start", () => {
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
    expect(pageNumbers(2, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
  });

  it("keeps the row steady near the end", () => {
    expect(pageNumbers(20, 20)).toEqual([1, "gap", 17, 18, 19, 20]);
  });

  it("never emits a gap that hides a single page", () => {
    for (let count = 1; count <= 30; count += 1) {
      for (let page = 1; page <= count; page += 1) {
        const entries = pageNumbers(page, count);
        const numbers = entries.filter((e): e is number => e !== "gap");
        // A gap must always stand for at least two missing pages, or it is
        // longer than what it replaced.
        entries.forEach((entry, index) => {
          if (entry !== "gap") return;
          const before = entries[index - 1] as number;
          const after = entries[index + 1] as number;
          expect(after - before).toBeGreaterThan(2);
        });
        expect(numbers).toContain(page);
        expect(numbers[0]).toBe(1);
        expect(numbers.at(-1)).toBe(count);
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      }
    }
  });
});

describe("resolvePage", () => {
  it("defaults to the first page", () => {
    expect(resolvePage(undefined, 5)).toBe(1);
    expect(resolvePage("", 5)).toBe(1);
  });

  it("clamps past the end rather than showing an empty page", () => {
    expect(resolvePage("99", 5)).toBe(5);
  });

  it("refuses nonsense", () => {
    expect(resolvePage("-2", 5)).toBe(1);
    expect(resolvePage("two", 5)).toBe(1);
    expect(resolvePage("1.5", 5)).toBe(1);
  });

  it("survives an empty list", () => {
    expect(resolvePage("3", 0)).toBe(1);
  });
});
