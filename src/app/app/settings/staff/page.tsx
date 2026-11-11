import { requireRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { addStaff, updateStaff } from "../actions";

export const metadata = { title: "Staff · Morekisi" };

const ROLE_HELP = {
  owner: "Everything, including settings, staff and costs",
  manager: "Products, stock, costs and approvals; no settings",
  staff: "Sales, stock checks, quotes, payments and orders; no cost prices",
};

export default async function StaffPage() {
  const session = await requireRole("owner");
  const db = await userClient();
  const { data: people } = await db
    .from("business_users")
    .select("id, name, phone, role, active, auth_user_id")
    .eq("business_id", session.current.businessId)
    .order("active", { ascending: false })
    .order("name");

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone listed here can use your shop's WhatsApp number as staff (back office) and sign in to this dashboard."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {(people ?? []).map((p) => {
                  const isMe = p.id === session.current.userId;
                  return (
                    <tr key={p.id} className={p.active ? "" : "text-neutral-400"}>
                      <td className="px-4 py-3">
                        {p.name}
                        {isMe && <span className="ml-2 text-xs text-neutral-400">(you)</span>}
                        {!p.auth_user_id && p.active && (
                          <span className="ml-2">
                            <Badge>not signed in yet</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{p.phone}</td>
                      <td className="px-4 py-3">
                        {isMe ? (
                          <Badge tone="green">{p.role}</Badge>
                        ) : (
                          <form action={updateStaff} className="flex gap-1">
                            <input type="hidden" name="id" value={p.id} />
                            <select
                              name="action"
                              defaultValue={p.role}
                              className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
                            >
                              <option value="owner">owner</option>
                              <option value="manager">manager</option>
                              <option value="staff">staff</option>
                            </select>
                            <button className="text-xs text-neutral-500 underline">Change</button>
                          </form>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isMe && (
                          <form action={updateStaff}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="action" value={p.active ? "deactivate" : "activate"} />
                            <button className={`text-xs underline ${p.active ? "text-red-700" : "text-emerald-700"}`}>
                              {p.active ? "Remove access" : "Restore access"}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <Card>
          <h2 className="mb-4 font-semibold">Add a person</h2>
          <ActionForm action={addStaff} submitLabel="Add">
            <Field label="Name">
              <Input name="name" placeholder="Kago Sello" required />
            </Field>
            <Field label="WhatsApp number">
              <Input name="phone" type="tel" placeholder="71 234 567" required />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="staff">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </Select>
            </Field>
            <ul className="space-y-1 text-xs text-neutral-500">
              {Object.entries(ROLE_HELP).map(([role, help]) => (
                <li key={role}>
                  <strong className="capitalize">{role}:</strong> {help}
                </li>
              ))}
            </ul>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
