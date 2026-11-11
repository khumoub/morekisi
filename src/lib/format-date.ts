/** Dates in Botswana time for dashboard tables. */
export function fmtDate(iso: string, withTime = false): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Gaborone",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime && { hour: "2-digit", minute: "2-digit" }),
  });
}

export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  orange_money: "Orange Money",
  myzaka: "MyZaka",
  smega: "Smega",
  eft: "EFT",
  credit: "Credit",
};
