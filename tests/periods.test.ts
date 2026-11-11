import { describe, expect, it } from "vitest";
import { periodRange, tzOffsetMinutes } from "@/lib/periods";

// Wednesday 11 Nov 2026, 00:30 in Gaborone (UTC+2) = Tuesday 10 Nov 22:30 UTC
const now = new Date("2026-11-10T22:30:00Z");
const iso = (r: { from: Date; to: Date }) => [r.from.toISOString(), r.to.toISOString()];

describe("report periods in Botswana time", () => {
  it("knows Gaborone is UTC+2", () => expect(tzOffsetMinutes("Africa/Gaborone", now)).toBe(120));
  it("today is the local calendar day, not the UTC one", () => {
    expect(iso(periodRange("today", now))).toEqual(["2026-11-10T22:00:00.000Z", "2026-11-11T22:00:00.000Z"]);
    expect(iso(periodRange("yesterday", now))).toEqual(["2026-11-09T22:00:00.000Z", "2026-11-10T22:00:00.000Z"]);
  });
  it("weeks start on Monday", () => {
    expect(iso(periodRange("this_week", now))).toEqual(["2026-11-08T22:00:00.000Z", "2026-11-15T22:00:00.000Z"]);
    expect(iso(periodRange("last_week", now))).toEqual(["2026-11-01T22:00:00.000Z", "2026-11-08T22:00:00.000Z"]);
  });
  it("months, including across a year boundary", () => {
    expect(iso(periodRange("this_month", now))).toEqual(["2026-10-31T22:00:00.000Z", "2026-11-30T22:00:00.000Z"]);
    const jan = new Date("2027-01-15T10:00:00Z");
    expect(iso(periodRange("last_month", jan))).toEqual(["2026-11-30T22:00:00.000Z", "2026-12-31T22:00:00.000Z"]);
  });
});
