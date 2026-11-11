"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, hasRole, requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { userClient } from "@/lib/db/user";
import { parsePula } from "@/lib/money";
import { toE164, toWaId } from "@/lib/phone";
import type { ActionResult } from "@/components/action-form";

/**
 * Dashboard actions on sales, quotations and customers. Writes to sales/quotes go through the
 * server-only database functions, after checking (as the signed-in user, under RLS) that the
 * record belongs to the user's current shop.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const METHODS = ["cash", "card", "orange_money", "myzaka", "smega", "eft", "credit"] as const;

export async function voidSale(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requireRole("manager");
  const id = str(form, "id");
  const reason = str(form, "reason");
  if (reason.length < 3) return { error: "Give a reason (it appears on the voided invoice and in the stock history)." };

  const db = await userClient();
  const { data: sale } = await db
    .from("sales")
    .select("id, status")
    .eq("id", id)
    .eq("business_id", session.current.businessId)
    .maybeSingle();
  if (!sale) return { error: "Sale not found." };
  if (sale.status !== "completed") return { error: "This sale is already void." };

  const { error } = await adminClient().rpc("void_sale", { p_sale: id, p_user: session.current.userId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/app/sales");
  return { success: "Sale voided. Its stock has been returned." };
}

export async function convertQuoteToSale(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const id = str(form, "id");
  const method = str(form, "method") as (typeof METHODS)[number];
  if (!METHODS.includes(method)) return { error: "Choose how the customer is paying." };

  const db = await userClient();
  const { data: quote } = await db
    .from("quotations")
    .select("id, status")
    .eq("id", id)
    .eq("business_id", session.current.businessId)
    .maybeSingle();
  if (!quote) return { error: "Quotation not found." };
  if (quote.status !== "open") return { error: `This quotation is already ${quote.status}.` };

  const { error } = await adminClient().rpc("convert_quote", { p_quote: id, p_user: session.current.userId, p_method: method });
  if (error) return { error: error.message };
  revalidatePath("/app/quotations");
  revalidatePath("/app/sales");
  redirect("/app/sales");
}

export async function saveCustomer(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const id = str(form, "id");
  const name = str(form, "name");
  if (name.length < 2) return { error: "Enter the customer's name." };

  const rawPhone = str(form, "phone");
  const phone = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !phone) return { error: "Enter a valid phone number, e.g. 71 234 567." };

  const fields: Record<string, unknown> = {
    name,
    phone,
    // Lets the WhatsApp bot recognise this customer when they message the shop.
    wa_id: phone ? toWaId(phone) : null,
    company: str(form, "company") || null,
    notes: str(form, "notes") || null,
    tags: str(form, "tags")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  };
  if (hasRole(session.current.role, "manager") && form.has("credit_limit")) {
    const limit = parsePula(str(form, "credit_limit") || "0");
    if (limit === null) return { error: "Credit limit must be an amount, e.g. 5000." };
    fields.credit_limit = limit;
  }

  const db = await userClient();
  const { data, error } = id
    ? await db.from("customers").update(fields).eq("id", id).eq("business_id", session.current.businessId).select("id").single()
    : await db.from("customers").insert({ ...fields, business_id: session.current.businessId, source: "manual" }).select("id").single();
  if (error) {
    if (error.message.includes("customers_wa_id")) return { error: "Another customer already has this phone number." };
    return { error: error.message };
  }
  revalidatePath("/app/customers");
  if (!id) redirect(`/app/customers/${data.id}`);
  return { success: "Saved." };
}
