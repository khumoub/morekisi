/**
 * Money is stored as integer thebe (1 BWP = 100 thebe) everywhere.
 * These helpers are the only place that converts to and from display text.
 */

const formatter = new Intl.NumberFormat("en-BW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 250000 → "P2,500.00", -10000 → "-P100.00" */
export function formatPula(thebe: number | bigint): string {
  const n = Number(thebe);
  const sign = n < 0 ? "-" : "";
  return `${sign}P${formatter.format(Math.abs(n) / 100)}`;
}

/**
 * Parses what people type: "P2,500", "2500.50", "p 95", "BWP 1 200", "1.2k".
 * Returns thebe, or null if the text isn't an amount.
 */
export function parsePula(text: string): number | null {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/^(bwp|pula|p)\s*/, "")
    .replace(/\s*(bwp|pula)$/, "")
    .replace(/[\s,]/g, "");
  const match = /^(\d+(?:\.\d{1,2})?)(k)?$/.exec(cleaned);
  if (!match) return null;
  const value = Number(match[1]) * (match[2] ? 1000 : 1);
  return Math.round(value * 100);
}
