import { describe, expect, it } from "vitest";
import { APPROVAL_WINDOW_HOURS, expiresAt, requestState, timeLeft } from "./approval";

const T0 = "2026-09-19T12:00:00.000Z";
const at = (hoursAfter: number) =>
  new Date(Date.parse(T0) + hoursAfter * 60 * 60 * 1000);

describe("expiresAt", () => {
  it("is exactly 72 hours after the request", () => {
    expect(expiresAt(T0).toISOString()).toBe("2026-09-22T12:00:00.000Z");
    expect(APPROVAL_WINDOW_HOURS).toBe(72);
  });
});

describe("requestState", () => {
  it("is waiting inside the window", () => {
    expect(requestState(T0, at(0))).toBe("waiting");
    expect(requestState(T0, at(71.9))).toBe("waiting");
  });

  it("is expired once the window closes", () => {
    expect(requestState(T0, at(72))).toBe("expired");
    expect(requestState(T0, at(100))).toBe("expired");
  });

  it("treats the boundary as closed, not open", () => {
    // A request made at noon Monday is dead at noon Thursday, not alive
    // through it. Ambiguity here is what makes a deadline argue-able.
    expect(requestState(T0, at(72))).toBe("expired");
  });
});

describe("timeLeft", () => {
  it("counts down in days while there are days", () => {
    expect(timeLeft(T0, at(0))).toBe("3 days left");
    expect(timeLeft(T0, at(25))).toBe("1 day left");
  });

  it("switches to hours inside the last day", () => {
    expect(timeLeft(T0, at(50))).toBe("22 hours left");
    expect(timeLeft(T0, at(71))).toBe("1 hour left");
  });

  it("switches to minutes in the last hour", () => {
    expect(timeLeft(T0, at(71.5))).toBe("30 minutes left");
  });

  it("never reports zero or a negative", () => {
    // Rounding down would say "0 minutes left" for the last 59 seconds.
    expect(timeLeft(T0, at(71.999))).toBe("1 minute left");
    expect(timeLeft(T0, at(72))).toBe("expired");
    expect(timeLeft(T0, at(200))).toBe("expired");
  });

  it("agrees with requestState at every hour of the window", () => {
    for (let h = 0; h <= 80; h += 1) {
      const expired = timeLeft(T0, at(h)) === "expired";
      expect(expired).toBe(requestState(T0, at(h)) === "expired");
    }
  });
});
