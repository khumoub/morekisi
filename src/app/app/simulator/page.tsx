import { notFound } from "next/navigation";
import { getProvider } from "@/lib/ai";
import { getSession } from "@/lib/auth/session";
import { simulatorEnabled } from "@/lib/simulator";
import { Notice, PageHeader } from "@/components/ui";
import { SimulatorChat } from "./chat";

export const metadata = { title: "Chat simulator · Morekisi" };

export default async function SimulatorPage() {
  if (!simulatorEnabled()) notFound();
  const { current } = await getSession();

  let aiLabel: string;
  try {
    const ai = getProvider();
    aiLabel = ai ? `AI: ${ai.name}` : "AI not configured: simple commands only";
  } catch (err) {
    aiLabel = `AI setting problem: ${(err as Error).message}`;
  }

  return (
    <>
      <PageHeader
        title="Chat simulator"
        description="Talk to your shop's WhatsApp bot without WhatsApp. Everything is real (sales, stock, invoices), except that replies appear here instead of on a phone."
      />
      {aiLabel.startsWith("AI not configured") && (
        <div className="mb-4">
          <Notice>
            Without an AI key the bot only understands simple commands (<em>stock cement</em>, <em>sales today</em>,{" "}
            <em>who owes us</em>). To record sales in your own words, add e.g. <code>AI_PROVIDER=deepseek</code> and{" "}
            <code>DEEPSEEK_API_KEY=…</code> to <code>.env.local</code>, then restart the app.
          </Notice>
        </div>
      )}
      <SimulatorChat aiLabel={aiLabel} myName={current.name.split(" ")[0]} />
    </>
  );
}
