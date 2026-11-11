"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/db/user";
import { BUSINESS_COOKIE, getSession } from "@/lib/auth/session";

export async function switchBusiness(form: FormData) {
  const id = String(form.get("business_id") ?? "");
  const session = await getSession();
  if (session.memberships.some((m) => m.businessId === id)) {
    (await cookies()).set(BUSINESS_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax" });
  }
  redirect("/app");
}

export async function signOut() {
  const db = await userClient();
  await db.auth.signOut();
  (await cookies()).delete(BUSINESS_COOKIE);
  redirect("/login");
}
