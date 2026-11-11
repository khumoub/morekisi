import "server-only";
import { userClient } from "@/lib/db/user";

export interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  sell_price: number;
  reorder_level: number;
  active: boolean;
  show_in_shop: boolean;
  track_stock: boolean;
  description: string | null;
  aliases: string[];
  category_id: string | null;
  category: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  low_stock: boolean;
  /** Only filled in for owners and managers. */
  cost_price: number | null;
}

const COLUMNS =
  "id, sku, name, unit, sell_price, reorder_level, active, show_in_shop, track_stock, description, aliases, category_id";

/** Products with stock levels, category names and (for managers) cost prices. */
export async function loadProducts(businessId: string, withCosts: boolean, ids?: string[]): Promise<ProductRow[]> {
  const db = await userClient();
  // Hide the internal "Delivery" service product (products without a SKU must stay visible).
  let q = db.from("products").select(COLUMNS).eq("business_id", businessId).or("sku.is.null,sku.neq.DELIVERY").order("name");
  if (ids) q = q.in("id", ids);

  const [products, stock, categories, costs] = await Promise.all([
    q,
    db.from("product_stock").select("product_id, on_hand, reserved, available, low_stock").eq("business_id", businessId),
    db.from("categories").select("id, name").eq("business_id", businessId),
    withCosts ? db.rpc("product_costs", { p_business: businessId }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (products.error) throw new Error(products.error.message);

  const stockBy = new Map((stock.data ?? []).map((s) => [s.product_id, s]));
  const catBy = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const costBy = new Map(((costs.data ?? []) as { product_id: string; cost_price: number }[]).map((c) => [c.product_id, c.cost_price]));

  return products.data.map((p) => {
    const s = stockBy.get(p.id);
    return {
      ...p,
      sell_price: Number(p.sell_price),
      reorder_level: Number(p.reorder_level),
      category: p.category_id ? (catBy.get(p.category_id) ?? null) : null,
      on_hand: Number(s?.on_hand ?? 0),
      reserved: Number(s?.reserved ?? 0),
      available: Number(s?.available ?? 0),
      low_stock: Boolean(s?.low_stock),
      cost_price: withCosts ? Number(costBy.get(p.id) ?? 0) : null,
    };
  });
}

export async function loadCategories(businessId: string) {
  const db = await userClient();
  const { data } = await db.from("categories").select("id, name").eq("business_id", businessId).order("name");
  return data ?? [];
}
