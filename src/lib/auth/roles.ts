import type { Role } from "@/lib/engine/types";

const RANK: Record<Role, number> = { staff: 0, manager: 1, owner: 2 };

/** True when `role` is at least `atLeast` (owner > manager > staff). */
export function hasRole(role: Role, atLeast: Role): boolean {
  return RANK[role] >= RANK[atLeast];
}
