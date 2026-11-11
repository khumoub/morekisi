"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { parsePula } from "@/lib/money";
import { toImportPayload, type ImportRow } from "@/lib/csv/products";
import type { ActionResult } from "@/components/action-form";

/** Optional form text: missing → "", trimmed, length-checked. */
const text = (max: number, min = 0, message = "Required") =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .pipe(z.string().min(min, message).max(max));

/** Optional amount typed as "95", "P95.00" → thebe, or null when empty. */
const money = z
  .string()
  .optional()
  .transform((raw, ctx): number | null => {
    const v = (raw ?? "").trim();
    if (v === "") return null;
    const n = parsePula(v);
    if (n === null) ctx.addIssue({ code: "custom", message: `"${v}" is not a valid amount` });
    return n;
  });

/** Optional quantity → number, or null when empty. */
const qty = z
  .string()
  .optional()
  .transform((raw, ctx): number | null => {
    const v = (raw ?? "").trim();
    if (v === "") return null;
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n)) ctx.addIssue({ code: "custom", message: `"${v}" is not a number` });
    return n;
  });

const productSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  name: text(120, 2, "Enter a product name"),
  sku: text(40),
  category_id: z.string().optional(),
  new_category: text(60),
  unit: text(20).transform((v) => v.toLowerCase() || "each"),
  sell_price: money,
  cost_price: money,
  reorder_level: qty,
  opening_stock: qty,
  description: text(500),
  aliases: text(300),
  show_in_shop: z.string().optional(),
  active: z.string().optional(),
});

function firstError(e: z.ZodError) {
  const i = e.issues[0];
  return i ? `${i.path.join(".") || "Form"}: ${i.message}` : "Invalid form";
}

export async function saveProduct(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requireRole("manager");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const p = parsed.data;
  if (p.sell_price === null) return { error: "Enter a selling price." };
  if (p.opening_stock !== null && p.opening_stock < 0) return { error: "Opening stock can't be negative." };

  const db = await userClient();
  const biz = session.current.businessId;

  let categoryId: string | null = p.category_id && p.category_id !== "" ? p.category_id : null;
  if (p.new_category) {
    const { error } = await db
      .from("categories")
      .upsert({ business_id: biz, name: p.new_category }, { onConflict: "business_id,name", ignoreDuplicates: true });
    if (error) return { error: error.message };
    const { data } = await db.from("categories").select("id").eq("business_id", biz).eq("name", p.new_category).single();
    categoryId = data?.id ?? null;
  }

  const fields = {
    name: p.name,
    sku: p.sku || null,
    category_id: categoryId,
    unit: p.unit,
    sell_price: p.sell_price,
    reorder_level: p.reorder_level ?? 0,
    description: p.description || null,
    aliases: p.aliases
      ? p.aliases
          .split(",")
          .map((a) => a.trim().toLowerCase())
          .filter(Boolean)
      : [],
    show_in_shop: p.show_in_shop === "on",
    active: p.id ? p.active === "on" : true,
    ...(p.cost_price !== null && { cost_price: p.cost_price }),
  };

  if (p.id) {
    const { error } = await db.from("products").update(fields).eq("id", p.id).eq("business_id", biz);
    if (error) return { error: friendly(error.message) };
  } else {
    const { data, error } = await db
      .from("products")
      .insert({ business_id: biz, ...fields })
      .select("id")
      .single();
    if (error) return { error: friendly(error.message) };
    if (p.opening_stock) {
      const { error: mErr } = await db.from("stock_movements").insert({
        business_id: biz,
        product_id: data.id,
        qty: p.opening_stock,
        type: "opening",
        reason: "Opening stock",
        created_by: session.current.userId,
      });
      if (mErr) return { error: mErr.message };
    }
  }

  revalidatePath("/app/products");
  redirect("/app/products");
}

export async function adjustStock(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requireRole("manager");
  const productId = String(form.get("product_id") ?? "");
  const counted = Number(String(form.get("counted") ?? "").replace(/,/g, ""));
  const reason = String(form.get("reason") ?? "").trim();
  if (!Number.isFinite(counted) || counted < 0) return { error: "Enter the quantity you counted." };
  if (!reason) return { error: "Give a reason, e.g. stock take, damaged, theft." };

  const db = await userClient();
  const { data: stock, error } = await db
    .from("product_stock")
    .select("on_hand")
    .eq("product_id", productId)
    .eq("business_id", session.current.businessId)
    .single();
  if (error) return { error: error.message };

  const diff = counted - Number(stock.on_hand);
  if (diff === 0) return { success: "Stock already matches your count." };

  const { error: mErr } = await db.from("stock_movements").insert({
    business_id: session.current.businessId,
    product_id: productId,
    qty: diff,
    type: "adjustment",
    reason,
    created_by: session.current.userId,
  });
  if (mErr) return { error: mErr.message };
  revalidatePath(`/app/products/${productId}`);
  return { success: `Stock ${diff > 0 ? "increased" : "reduced"} by ${Math.abs(diff)}.` };
}

export async function importProducts(rows: ImportRow[]): Promise<{ error?: string; created?: number; updated?: number }> {
  const session = await requireRole("manager");
  if (rows.length === 0) return { error: "Nothing to import." };
  if (rows.length > 5000) return { error: "Please import at most 5,000 products at a time." };

  const db = await userClient();
  const { data, error } = await db.rpc("import_products", {
    p_business: session.current.businessId,
    p_rows: toImportPayload(rows),
  });
  if (error) return { error: error.message };
  revalidatePath("/app/products");
  return data as { created: number; updated: number };
}

function friendly(message: string) {
  if (message.includes("products_business_id_sku_key")) return "Another product already uses that code (SKU).";
  return message;
}
