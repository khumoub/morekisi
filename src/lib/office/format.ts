import { formatPula } from "@/lib/money";
import type { PaymentMethod, ShopSettings } from "@/lib/engine/types";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  orange_money: "Orange Money",
  myzaka: "MyZaka",
  smega: "Smega",
  eft: "EFT / bank transfer",
  credit: "Credit (on account)",
};

export function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** Line total exactly as the database computes it: round(qty × unit price). */
export function lineTotal(qty: number, unitPrice: number): number {
  return Math.round(qty * unitPrice);
}

/** VAT included in a total, exactly as create_sale computes it. */
export function vatIncluded(total: number, s: ShopSettings): number {
  if (!s.vatRegistered) return 0;
  return s.pricesIncludeVat ? Math.round((total * s.vatRateBp) / (10000 + s.vatRateBp)) : Math.round((total * s.vatRateBp) / 10000);
}

/** Total payable: VAT-inclusive prices are already the total; otherwise VAT is added on top. */
export function grandTotal(total: number, s: ShopSettings): number {
  return s.vatRegistered && !s.pricesIncludeVat ? total + vatIncluded(total, s) : total;
}

export { formatPula };
