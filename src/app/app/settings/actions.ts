"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { parseDeliveryAreas } from "@/lib/delivery-areas";
import { parsePula } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import type { ActionResult } from "@/components/action-form";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const roles = ["owner", "manager", "staff"] as const;

// ───────────────────────── Shop settings ─────────────────────────
export async function saveSettings(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { current } = await requireRole("owner");
  const name = str(form, "name");
  if (name.length < 2) return { error: "Enter the shop's name." };

  const vatRegistered = form.get("vat_registered") === "on";
  const vatNumber = str(form, "vat_number");
  if (vatRegistered && !vatNumber) return { error: "Enter your VAT number, or untick “VAT registered”." };

  const { areas, errors } = parseDeliveryAreas(str(form, "delivery_areas"));
  if (errors.length) return { error: `Delivery areas: ${errors[0]}` };

  const creditLimit = parsePula(str(form, "credit_approval_limit") || "0");
  if (creditLimit === null) return { error: "Credit approval limit must be an amount." };

  const time = str(form, "daily_report_time") || "18:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Evening summary time must look like 18:00." };

  const db = await userClient();
  const { error } = await db
    .from("businesses")
    .update({
      name,
      trading_name: str(form, "trading_name") || null,
      address: str(form, "address") || null,
      phone: str(form, "phone") || null,
      email: str(form, "email") || null,
      vat_registered: vatRegistered,
      vat_number: vatNumber || null,
      prices_include_vat: form.get("prices_include_vat") === "on",
      invoice_footer: str(form, "invoice_footer") || null,
      welcome_message: str(form, "welcome_message") || null,
      require_order_approval: form.get("require_order_approval") === "on",
      credit_approval_limit: creditLimit,
      daily_report_time: time,
      delivery_areas: areas,
    })
    .eq("id", current.businessId);
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  return { success: "Settings saved." };
}

// ───────────────────────── Staff ─────────────────────────
export async function addStaff(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { current } = await requireRole("owner");
  const name = str(form, "name");
  const phone = toE164(str(form, "phone"));
  const role = str(form, "role") as (typeof roles)[number];
  if (name.length < 2) return { error: "Enter the person's name." };
  if (!phone) return { error: "Enter a valid phone number, e.g. 71 234 567." };
  if (!roles.includes(role)) return { error: "Choose a role." };

  const db = await userClient();
  const { data: existing } = await db
    .from("business_users")
    .select("id, active")
    .eq("business_id", current.businessId)
    .eq("phone", phone)
    .maybeSingle();

  const { error } = existing
    ? await db.from("business_users").update({ name, role, active: true }).eq("id", existing.id)
    : await db.from("business_users").insert({ business_id: current.businessId, name, phone, role });
  if (error) return { error: error.message };

  revalidatePath("/app/settings/staff");
  return {
    success: `${name} can now message your shop's WhatsApp number from ${phone} and sign in to the dashboard with it.`,
  };
}

export async function updateStaff(form: FormData): Promise<void> {
  const session = await requireRole("owner");
  const id = str(form, "id");
  const action = str(form, "action");
  const db = await userClient();

  const { data: owners } = await db
    .from("business_users")
    .select("id")
    .eq("business_id", session.current.businessId)
    .eq("role", "owner")
    .eq("active", true);
  const isLastOwner = owners?.length === 1 && owners[0].id === id;

  if (action === "deactivate") {
    if (id === session.current.userId || isLastOwner) return; // never lock the shop out
    await db.from("business_users").update({ active: false }).eq("id", id).eq("business_id", session.current.businessId);
  } else if (action === "activate") {
    await db.from("business_users").update({ active: true }).eq("id", id).eq("business_id", session.current.businessId);
  } else if (roles.includes(action as (typeof roles)[number])) {
    if (isLastOwner && action !== "owner") return;
    await db.from("business_users").update({ role: action }).eq("id", id).eq("business_id", session.current.businessId);
  }
  revalidatePath("/app/settings/staff");
}

// ───────────────────────── WhatsApp ─────────────────────────
export async function connectWhatsApp(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { current } = await requireRole("owner");
  const phoneNumberId = str(form, "phone_number_id");
  const wabaId = str(form, "waba_id");
  const displayPhone = str(form, "display_phone");
  const token = str(form, "access_token");
  if (!/^\d{6,20}$/.test(phoneNumberId)) return { error: "Phone number ID is the long number from Meta's WhatsApp → API setup page." };
  if (!/^\d{6,20}$/.test(wabaId)) return { error: "WhatsApp Business Account ID should be digits only." };
  if (!toE164(displayPhone)) return { error: "Enter the shop's WhatsApp number, e.g. +267 71 234 567." };

  const db = await userClient();
  const { error } = await db.rpc("connect_wa_account", {
    p_business: current.businessId,
    p_phone_number_id: phoneNumberId,
    p_waba_id: wabaId,
    p_display_phone: toE164(displayPhone),
    p_token: token || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  return { success: "WhatsApp connected. Send “hi” to your shop's number to test it." };
}

export async function disconnectWhatsApp(): Promise<ActionResult> {
  const { current } = await requireRole("owner");
  const db = await userClient();
  const { error } = await db.rpc("disconnect_wa_account", { p_business: current.businessId });
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  return { success: "WhatsApp disconnected. Messages to the number will no longer be answered." };
}
