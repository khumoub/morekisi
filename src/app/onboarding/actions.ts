"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/db/user";
import { BUSINESS_COOKIE } from "@/lib/auth/session";
import type { ActionResult } from "@/components/action-form";

export async function createBusiness(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const name = String(form.get("name") ?? "").trim();
  const ownerName = String(form.get("owner_name") ?? "").trim();
  if (name.length < 2) return { error: "Enter your shop's name." };
  if (ownerName.length < 2) return { error: "Enter your name." };

  const db = await userClient();
  const { data, error } = await db.rpc("create_business", { p_name: name, p_owner_name: ownerName });
  if (error) return { error: error.message };

  (await cookies()).set(BUSINESS_COOKIE, data as string, { path: "/", httpOnly: true, sameSite: "lax" });
  redirect("/app");
}
