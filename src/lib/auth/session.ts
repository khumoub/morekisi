import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/db/user";
import type { Role } from "@/lib/engine/types";
import { hasRole } from "./roles";

export const BUSINESS_COOKIE = "mk_business";

export interface Membership {
  businessId: string;
  businessName: string;
  userId: string; // business_users.id
  name: string;
  role: Role;
}

export interface Session {
  authUserId: string;
  phone: string | null;
  memberships: Membership[];
  current: Membership;
}

export { hasRole } from "./roles";

/** The signed-in user and their shops. Redirects to /login or /onboarding when needed. Cached per request. */
export const getSession = cache(async (): Promise<Session> => {
  const db = await userClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await db
    .from("business_users")
    .select("id, name, role, business_id, businesses(name)")
    .eq("auth_user_id", user.id)
    .eq("active", true);
  if (error) throw new Error(error.message);

  const memberships: Membership[] = (data ?? []).map((m) => ({
    businessId: m.business_id,
    businessName: (m.businesses as unknown as { name: string }).name,
    userId: m.id,
    name: m.name,
    role: m.role as Role,
  }));
  if (memberships.length === 0) redirect("/onboarding");

  const chosen = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const current = memberships.find((m) => m.businessId === chosen) ?? memberships[0];
  return { authUserId: user.id, phone: user.phone ?? null, memberships, current };
});

/** For pages and actions that need a minimum role in the current shop. */
export async function requireRole(atLeast: Role): Promise<Session> {
  const session = await getSession();
  if (!hasRole(session.current.role, atLeast)) redirect("/app?denied=1");
  return session;
}
