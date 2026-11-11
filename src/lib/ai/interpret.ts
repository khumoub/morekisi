import { interpretationJsonSchema, interpretationSchema, type Interpretation } from "./intent";
import { AiUnavailableError, type LlmProvider } from "./provider";

export const INSTRUCTIONS = `You read WhatsApp messages that shop staff in Botswana send to Morekisi, their shop's back-office assistant, and turn each message into one structured action. You never invent prices, stock levels or totals: the shop's database supplies those. Your job is only to work out what the person wants and pull out the details.

How staff write: short, informal, often without punctuation, mixing English and Setswana, with abbreviations ("cem" = cement, "12mm"/"Y12" = rebar size, "pcs", "bgs"), numbers as digits or words ("twenty", "lesome" = 10, "masome a mabedi" = 20), money as "P95", "95 pula", "1.5k" (= 1500). Quantities can come after the product ("cement x20").

Choose exactly one intent:
- record_sale: something was sold ("sold", "rekisitse", "customer took", "invoice X for…").
- record_payment: a customer paid money they owed ("Kabelo paid 500", "o duetse").
- stock_in: goods arrived from a supplier ("received", "delivered by", "stock in", "re amogetse").
- create_quote: someone wants a price quotation prepared.
- check_stock: how much of something is in stock.
- check_price: the selling price of something.
- customer_balance: what a customer owes, or who owes the shop.
- report: sales, takings or profit for a period ("sales today", "how did we do this week").
- ask: any other question about the business (best sellers, comparisons, advice from the shop's data).
- confirm: agreeing to the action waiting for confirmation ("yes", "ok", "confirm", "ee", "go ahead"). Only when the recent conversation shows something waiting.
- cancel: rejecting it ("no", "cancel", "nnyaa", "stop").
- help: greetings or "what can you do".
- unclear: you genuinely cannot tell; put a short, specific clarifying question in "reply".

Fields:
- items: one entry per product mentioned. "product": if the shop catalogue below clearly contains it, copy the catalogue name exactly; otherwise copy the person's words. "qty": number or null if not said. "unit_price": Pula per unit only if the person stated a price (for stock_in this is the cost price), else null.
- customer: the customer's name as written, or null. Not the supplier.
- payment_method: cash, card (also "swipe"), orange_money ("OM", "orange"), myzaka ("mascom", "my zaka"), smega ("BTC", "be mobile"), eft ("transfer", "bank"), credit ("on account", "on credit", "pay later", "o tla duela"), or null if not said.
- amount: Pula amount for payments, else null.
- supplier: for stock_in, the supplier's name or null.
- period: for report/ask about a time range: today, yesterday, this_week, last_week, this_month, last_month; else null.
- question: for ask, the question restated clearly in English; else null.
- reply: only for unclear and help — a short message to send back, in the person's language; else null.
- language: "tn" if the person wrote mostly in Setswana, otherwise "en".

Use the recent conversation to understand follow-ups ("make it 25", "the 42.5 one", "to Kabelo"): repeat the full action with the corrected details.`;

export interface InterpretInput {
  shopName: string;
  /** Product names (with units) from the shop's catalogue. */
  catalogue: { name: string; unit: string }[];
  /** Oldest first. */
  history: { from: "staff" | "morekisi"; text: string }[];
  /** Summary of the action waiting for Confirm/Cancel, if any. */
  pending: string | null;
  message: string;
}

const MAX_CATALOGUE = 400;

export function shopContext(input: Pick<InterpretInput, "shopName" | "catalogue">): string {
  const shown = input.catalogue.slice(0, MAX_CATALOGUE);
  const lines = shown.map((p) => `- ${p.name} (${p.unit})`).join("\n");
  const more = input.catalogue.length > shown.length ? `\n(…and ${input.catalogue.length - shown.length} more not listed)` : "";
  return `Shop: ${input.shopName}\nProduct catalogue:\n${lines || "(no products yet)"}${more}`;
}

export function conversationInput(input: Pick<InterpretInput, "history" | "pending" | "message">): string {
  const history = input.history.length
    ? input.history.map((h) => `${h.from === "staff" ? "Staff" : "Morekisi"}: ${h.text}`).join("\n")
    : "(none)";
  return [
    `Recent conversation:\n${history}`,
    `Waiting for confirmation: ${input.pending ?? "nothing"}`,
    `New message from staff:\n${input.message}`,
  ].join("\n\n");
}

/** Asks the model what the message means. Returns a validated Interpretation. */
export async function interpret(provider: LlmProvider, input: InterpretInput): Promise<Interpretation> {
  const raw = await provider.json({
    instructions: INSTRUCTIONS,
    shopContext: shopContext(input),
    input: conversationInput(input),
    schemaName: "interpretation",
    schema: interpretationJsonSchema as unknown as Record<string, unknown>,
  });
  const parsed = interpretationSchema.safeParse(raw);
  if (!parsed.success) throw new AiUnavailableError(`Interpretation failed validation: ${parsed.error.message}`, "invalid");
  return parsed.data;
}
