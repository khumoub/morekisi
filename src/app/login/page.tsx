"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/db/browser";
import { toE164 } from "@/lib/phone";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

/** Supabase errors are technical; show something a shop owner can act on. */
function friendly(message: string) {
  if (/fetch|network/i.test(message)) return "We couldn't reach Morekisi. Check your internet connection and try again.";
  if (/expired|invalid/i.test(message)) return "That code is wrong or has expired. Request a new one.";
  if (/rate|too many/i.test(message)) return "Too many attempts. Please wait a minute and try again.";
  return message;
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/app";
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const e164 = toE164(phone);
    if (!e164) return setError("Enter a valid phone number, e.g. 71 234 567.");
    setBusy(true);
    const { error } = await browserClient().auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    setPhone(e164);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const db = browserClient();
    const { error } = await db.auth.verifyOtp({ phone, token: code.trim(), type: "sms" });
    if (error) {
      setBusy(false);
      return setError(friendly(error.message));
    }
    // Link any shops this phone was added to as staff.
    await db.rpc("claim_memberships");
    // Only same-site paths: "//evil.com" or "/\\evil.com" would leave the site.
    router.replace(/^\/(?![\/\\])/.test(next) ? next : "/app");
    router.refresh();
  }

  return (
    <Card>
      {step === "phone" ? (
        <form onSubmit={sendCode} className="space-y-4">
          <Field label="Your phone number" hint="We'll send a 6-digit code to your WhatsApp.">
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="71 234 567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Sending…" : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <Field label="Enter the code" hint={`Sent to ${phone}`}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy || code.length < 6} className="w-full">
            {busy ? "Checking…" : "Sign in"}
          </Button>
          <button type="button" className="w-full text-sm text-neutral-500 underline" onClick={() => setStep("phone")}>
            Use a different number
          </button>
        </form>
      )}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Morekisi</p>
      <h1 className="mb-6 mt-1 text-2xl font-semibold">Sign in to your shop</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
