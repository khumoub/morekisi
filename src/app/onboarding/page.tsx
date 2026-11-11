import { redirect } from "next/navigation";
import { userClient } from "@/lib/db/user";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";
import { createBusiness } from "./actions";

export const metadata = { title: "Set up your shop · Morekisi" };

export default async function OnboardingPage() {
  const db = await userClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");

  await db.rpc("claim_memberships");
  const { count } = await db
    .from("business_users")
    .select("id", { count: "exact", head: true })
    .eq("auth_user_id", user.id)
    .eq("active", true);
  if ((count ?? 0) > 0) redirect("/app");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Morekisi</p>
      <h1 className="mt-1 text-2xl font-semibold">Set up your shop</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">
        You can add products, staff and your WhatsApp number next. If you work at a shop that already uses Morekisi,
        ask the owner to add your number instead.
      </p>
      <Card>
        <ActionForm action={createBusiness} submitLabel="Create my shop">
          <Field label="Shop name">
            <Input name="name" placeholder="Molefe Hardware" required autoFocus />
          </Field>
          <Field label="Your name">
            <Input name="owner_name" placeholder="Neo Molefe" required />
          </Field>
        </ActionForm>
      </Card>
    </main>
  );
}
