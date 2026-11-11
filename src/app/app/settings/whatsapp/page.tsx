import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/session";
import { userClient } from "@/lib/db/user";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, Notice, PageHeader } from "@/components/ui";
import { connectWhatsApp, disconnectWhatsApp } from "../actions";

export const metadata = { title: "WhatsApp · Morekisi" };

export default async function WhatsAppPage() {
  const { current } = await requireRole("owner");
  const db = await userClient();
  const { data: account } = await db
    .from("wa_accounts")
    .select("phone_number_id, waba_id, display_phone, token_secret_id, created_at")
    .eq("business_id", current.businessId)
    .eq("active", true)
    .maybeSingle();

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-domain";
  const webhookUrl = `https://${host}/api/whatsapp`;

  return (
    <>
      <PageHeader title="WhatsApp" description="Connect your shop's WhatsApp Business number to Morekisi." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {account ? (
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-neutral-500">Connected number</p>
                  <p className="text-xl font-semibold">{account.display_phone}</p>
                </div>
                <Badge tone="green">connected</Badge>
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-neutral-500">Phone number ID</dt>
                  <dd className="font-mono">{account.phone_number_id}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Business account ID</dt>
                  <dd className="font-mono">{account.waba_id}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Access token</dt>
                  <dd>{account.token_secret_id ? "Stored securely" : "Using the Morekisi platform token"}</dd>
                </div>
              </dl>
              <div className="mt-4">
                <ActionForm action={disconnectWhatsApp} submitLabel="Disconnect" variant="danger" />
              </div>
            </Card>
          ) : (
            <Notice>No WhatsApp number connected yet. Customers and staff can&apos;t reach your shop until you connect one.</Notice>
          )}

          <Card>
            <h2 className="mb-1 font-semibold">{account ? "Update connection" : "Connect a number"}</h2>
            <p className="mb-4 text-sm text-neutral-500">
              Copy these from Meta: <em>developers.facebook.com → your app → WhatsApp → API setup</em>. One-click
              connection (Meta Embedded Signup) will replace this form once Morekisi is an approved Meta Tech Provider.
            </p>
            <ActionForm action={connectWhatsApp} submitLabel={account ? "Update" : "Connect WhatsApp"}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone number ID">
                  <Input name="phone_number_id" defaultValue={account?.phone_number_id} inputMode="numeric" required />
                </Field>
                <Field label="WhatsApp Business Account ID">
                  <Input name="waba_id" defaultValue={account?.waba_id} inputMode="numeric" required />
                </Field>
                <Field label="The shop's WhatsApp number">
                  <Input name="display_phone" defaultValue={account?.display_phone} placeholder="+267 71 234 567" required />
                </Field>
                <Field
                  label="Permanent access token"
                  hint={account?.token_secret_id ? "Leave empty to keep the stored token." : "From a Meta system user. Stored encrypted."}
                >
                  <Input name="access_token" type="password" autoComplete="off" placeholder="EAAG…" />
                </Field>
              </div>
            </ActionForm>
          </Card>
        </div>

        <Card>
          <h2 className="mb-3 font-semibold">Meta webhook settings</h2>
          <p className="text-sm text-neutral-500">In your Meta app, set the WhatsApp webhook to:</p>
          <p className="mt-2 break-all rounded-md bg-neutral-100 px-3 py-2 font-mono text-xs dark:bg-neutral-800">{webhookUrl}</p>
          <p className="mt-3 text-sm text-neutral-500">
            Use the verify token from your Morekisi server settings (<code>WHATSAPP_VERIFY_TOKEN</code>) and subscribe to the{" "}
            <strong>messages</strong> field.
          </p>
          <h3 className="mt-5 text-sm font-semibold">Before you connect</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-500">
            <li>A number used with the WhatsApp API can&apos;t also be used in the normal WhatsApp Business app, unless Meta has set it up for both.</li>
            <li>Make sure your staff&apos;s numbers are added under Staff, so the bot treats them as staff, not customers.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
