import { describe, expect, it } from "vitest";
import { dayRange, defaultDay, isValidDay, newsroomToday, weekDays } from "./week";

// Wednesday 16 September 2026, mid-morning in New York.
const WEDNESDAY = new Date("2026-09-16T14:00:00Z");
const MONDAY = "2026-09-14";

describe("the week", () => {
  it("runs Monday to Sunday", () => {
    const days = weekDays(MONDAY, WEDNESDAY);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: "2026-09-14", short: "Mon" });
    expect(days[6]).toMatchObject({ date: "2026-09-20", short: "Sun" });
  });

  it("locks the days that have not arrived", () => {
    const days = weekDays(MONDAY, WEDNESDAY);
    const locked = days.filter((d) => d.isFuture).map((d) => d.short);

    expect(locked).toEqual(["Thu", "Fri", "Sat", "Sun"]);
  });

  it("leaves today and the days before it open", () => {
    const open = weekDays(MONDAY, WEDNESDAY).filter((d) => !d.isFuture).map((d) => d.short);
    expect(open).toEqual(["Mon", "Tue", "Wed"]);
  });

  it("marks today", () => {
    const today = weekDays(MONDAY, WEDNESDAY).filter((d) => d.isToday);
    expect(today.map((d) => d.short)).toEqual(["Wed"]);
  });

  it("uses the newsroom's clock, not the viewer's", () => {
    // 01:00 UTC Thursday is still Wednesday evening in New York.
    expect(newsroomToday(new Date("2026-09-17T01:00:00Z"))).toBe("2026-09-16");
  });
});

describe("the day a reader lands on", () => {
  it("is today during the week", () => {
    expect(defaultDay(weekDays(MONDAY, WEDNESDAY))).toBe("2026-09-16");
  });

  it("is the last real day once the week has passed", () => {
    const days = weekDays(MONDAY, new Date("2026-09-28T14:00:00Z"));
    expect(defaultDay(days)).toBe("2026-09-20");
  });
});

describe("day boundaries", () => {
  it("run local midnight to local midnight", () => {
    // September is EDT, UTC-4, so a New York day starts at 04:00 UTC.
    const { start, end } = dayRange("2026-09-14");
    expect(start).toBe("2026-09-14T04:00:00.000Z");
    expect(end).toBe("2026-09-15T04:00:00.000Z");
  });

  it("follow daylight saving rather than assuming an offset", () => {
    // January is EST, UTC-5.
    expect(dayRange("2027-01-14").start).toBe("2027-01-14T05:00:00.000Z");
  });
});

describe("validation", () => {
  const days = weekDays(MONDAY, WEDNESDAY);

  it("accepts a day that has happened", () => {
    expect(isValidDay("2026-09-14", days)).toBe(true);
  });

  it("refuses a day that has not", () => {
    expect(isValidDay("2026-09-18", days)).toBe(false);
  });

  it("refuses anything outside the week, or nonsense", () => {
    expect(isValidDay("2026-10-01", days)).toBe(false);
    expect(isValidDay("not-a-date", days)).toBe(false);
    expect(isValidDay(undefined, days)).toBe(false);
  });
});
