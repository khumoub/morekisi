import Link from "next/link";
import type { ReactNode } from "react";
import { getSession, hasRole } from "@/lib/auth/session";
import { simulatorEnabled } from "@/lib/simulator";
import { signOut, switchBusiness } from "./actions";

const nav = [
  { href: "/app", label: "Home", minRole: "staff" },
  { href: "/app/sales", label: "Sales", minRole: "staff" },
  { href: "/app/quotations", label: "Quotations", minRole: "staff" },
  { href: "/app/customers", label: "Customers", minRole: "staff" },
  { href: "/app/products", label: "Products", minRole: "staff" },
  { href: "/app/settings", label: "Shop settings", minRole: "owner" },
  { href: "/app/settings/staff", label: "Staff", minRole: "owner" },
  { href: "/app/settings/whatsapp", label: "WhatsApp", minRole: "owner" },
] as const;

const simulatorLink = { href: "/app/simulator", label: "💬 Chat simulator", minRole: "staff" } as const;

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const { current, memberships } = session;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/app" className="font-semibold text-emerald-700">
              Morekisi
            </Link>
            {memberships.length > 1 ? (
              <form action={switchBusiness} className="flex items-center gap-1">
                <select
                  name="business_id"
                  defaultValue={current.businessId}
                  className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
                >
                  {memberships.map((m) => (
                    <option key={m.businessId} value={m.businessId}>
                      {m.businessName}
                    </option>
                  ))}
                </select>
                <button className="text-sm text-neutral-500 underline">Switch</button>
              </form>
            ) : (
              <span className="text-sm text-neutral-500">{current.businessName}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-neutral-500">
              {current.name} · {current.role}
            </span>
            <form action={signOut}>
              <button className="text-neutral-500 underline">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {[...nav, ...(simulatorEnabled() ? [simulatorLink] : [])]
            .filter((n) => hasRole(current.role, n.minRole))
            .map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="whitespace-nowrap rounded-t-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                {n.label}
              </Link>
            ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
