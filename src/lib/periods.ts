/**
 * Report periods in the shop's local time ("today" in Gaborone, not in UTC).
 * Weeks start on Monday.
 */
export type Period = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month";

export const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
};

/** Minutes the zone is ahead of UTC at `at`, e.g. +120 for Africa/Gaborone. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? "");
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Local calendar date (y, m 0-based, d, weekday 0=Mon) of `at` in the zone. */
function localParts(timeZone: string, at: Date) {
  const shifted = new Date(at.getTime() + tzOffsetMinutes(timeZone, at) * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    weekday: (shifted.getUTCDay() + 6) % 7,
  };
}

/** UTC instant of local midnight on y-m-d in the zone. */
function localMidnight(timeZone: string, y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m, d));
  return new Date(guess.getTime() - tzOffsetMinutes(timeZone, guess) * 60_000);
}

export function periodRange(period: Period, now: Date, timeZone = "Africa/Gaborone"): { from: Date; to: Date } {
  const { y, m, d, weekday } = localParts(timeZone, now);
  const day = (offset: number) => localMidnight(timeZone, y, m, d + offset);
  switch (period) {
    case "today":
      return { from: day(0), to: day(1) };
    case "yesterday":
      return { from: day(-1), to: day(0) };
    case "this_week":
      return { from: day(-weekday), to: day(7 - weekday) };
    case "last_week":
      return { from: day(-weekday - 7), to: day(-weekday) };
    case "this_month":
      return { from: localMidnight(timeZone, y, m, 1), to: localMidnight(timeZone, y, m + 1, 1) };
    case "last_month":
      return { from: localMidnight(timeZone, y, m - 1, 1), to: localMidnight(timeZone, y, m, 1) };
  }
}
