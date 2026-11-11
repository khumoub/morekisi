import { interpret } from "@/lib/ai/interpret";
import type { Interpretation } from "@/lib/ai/intent";
import { AiUnavailableError } from "@/lib/ai/provider";
import type { Context } from "@/lib/engine/types";
import { answerBalance, answerQuestion, answerReport, answerStockOrPrice } from "./answers";
import { answerPending, continuePending, describePending, startDraft, type PendingPayload } from "./flows";

/**
 * Back office: messages from the shop's own staff.
 *
 * 1. Replies to something the bot asked (list picks, Confirm/Cancel, a customer name).
 * 2. Everything else is understood by the AI (any wording, English or Setswana).
 * 3. Without AI (not configured or temporarily down), simple keyword commands still work.
 */

const NULL_FIELDS = {
  items: [],
  customer: null,
  payment_method: null,
  amount: null,
  supplier: null,
  period: null,
  question: null,
  reply: null,
  language: "en",
} satisfies Omit<Interpretation, "intent">;

/** Keyword fallback for when the AI isn't available. */
export function parseCommand(text: string): Interpretation {
  const t = text.trim().toLowerCase().replace(/[?!.]+$/, "");
  if (/^(hi|hello|dumela|help|menu|start)$/.test(t)) return { ...NULL_FIELDS, intent: "help" };

  const stock = /^(?:stock|check stock|how (?:much|many)(?: of)?|do we have|re na le)\s+(.+?)(?:\s+(?:do we have|left|in stock))?$/.exec(t);
  if (stock) return { ...NULL_FIELDS, intent: "check_stock", items: [{ product: stock[1], qty: null, unit_price: null }] };

  const price = /^(?:price of|price|how much is|cost of)\s+(?:a |an |the )?(.+)$/.exec(t);
  if (price) return { ...NULL_FIELDS, intent: "check_price", items: [{ product: price[1], qty: null, unit_price: null }] };

  if (/^(who owes( us)?|debtors|balances)$/.test(t)) return { ...NULL_FIELDS, intent: "customer_balance" };
  const report = /^(sales|report|takings)(?: (today|yesterday|this week|this month))?$/.exec(t);
  if (report) {
    const period = (report[2] ?? "today").replace(" ", "_") as Interpretation["period"];
    return { ...NULL_FIELDS, intent: "report", period };
  }
  return { ...NULL_FIELDS, intent: "unclear" };
}

const HELP = (name: string, shop: string) =>
  `Dumela ${name} 👋 I'm the *${shop}* back office. Just write to me normally, for example:\n\n` +
  "• _sold 20 cement and 5 rebar 12mm to Kabelo on credit_\n" +
  "• _Kabelo paid P500 orange money_\n" +
  "• _received 200 cement from Builders Depot at P78_\n" +
  "• _how much rebar do we have?_ / _price of IBR sheets_\n" +
  "• _who owes us?_ / _sales today_ / _what sold best this month?_\n\n" +
  "I always show you a summary to *Confirm* before saving anything. Send */shop* to see your WhatsApp shop as a customer.";

function messageText(ctx: Context): string | null {
  const c = ctx.message.content;
  if (c.kind === "text") return c.text;
  if (c.kind === "button" || c.kind === "list") return c.title;
  return null;
}

export async function handleOffice(ctx: Context): Promise<void> {
  if (ctx.party.kind !== "staff") return;
  const user = ctx.party.user;
  const { repo, business, message } = ctx;
  const c = message.content;

  if (c.kind === "audio") {
    await ctx.reply({ type: "text", text: "🎙️ Voice notes are coming soon. For now, please type the message." });
    return;
  }
  const text = messageText(ctx);
  if (text === null) {
    await ctx.reply({ type: "text", text: "I can only read text messages for now." });
    return;
  }

  if (text.trim().toLowerCase() === "/shop") {
    await repo.updateConversation(ctx.conversation.id, { state: { ...ctx.conversation.state, staffTestingShop: true } });
    await ctx.reply({ type: "text", text: "🛍️ You're now seeing the shop as a customer. Send *hi* to start, or */office* to come back." });
    return;
  }

  // 1. Answers to something we asked
  const pending = await repo.getPending(user.id);
  const payload = pending ? (pending.payload as PendingPayload) : null;
  const expired = pending ? pending.expiresAt.getTime() < ctx.now.getTime() : false;
  if (payload && (await continuePending(ctx, payload, expired))) return;

  if ((c.kind === "button" || c.kind === "list") && /^(pa|pick):/.test(c.id)) {
    await ctx.reply({ type: "text", text: "That isn't waiting any more. Please send the message again." });
    return;
  }

  // 2. Understand the message
  let it: Interpretation;
  if (ctx.ai) {
    try {
      const [catalogue, recent] = await Promise.all([
        repo.catalogue(business.id),
        repo.recentMessages(ctx.conversation.id, 9),
      ]);
      // The newest inbound row is this message itself.
      const history = recent.slice(0, -1).map((m) => ({ from: m.direction === "in" ? ("staff" as const) : ("morekisi" as const), text: m.text }));
      it = await interpret(ctx.ai, {
        shopName: business.name,
        catalogue,
        history,
        pending: payload && !expired ? describePending(payload) : null,
        message: text,
      });
    } catch (err) {
      console.error("ai interpret failed", err instanceof AiUnavailableError ? err.reason : err);
      it = parseCommand(text);
      if (it.intent === "unclear") {
        await ctx.reply({ type: "text", text: "Sorry, I couldn't process that just now. Please try again in a moment." });
        return;
      }
    }
  } else {
    it = parseCommand(text);
  }

  // 3. Act on it
  switch (it.intent) {
    case "record_sale":
    case "record_payment":
    case "stock_in":
      await startDraft(ctx, it);
      return;

    case "confirm":
    case "cancel":
      if (!payload) {
        await ctx.reply({ type: "text", text: "There's nothing waiting for confirmation." });
        return;
      }
      await answerPending(ctx, payload, expired, it.intent === "confirm");
      return;

    case "create_quote":
      await ctx.reply({
        type: "text",
        text: `📝 I understood a quotation${it.customer ? ` for *${it.customer}*` : ""}. Creating quotations on WhatsApp is coming in the next update.`,
      });
      return;

    case "check_stock":
      await answerStockOrPrice(ctx, "stock", it.items.map((i) => i.product));
      return;
    case "check_price":
      await answerStockOrPrice(ctx, "price", it.items.map((i) => i.product));
      return;
    case "customer_balance":
      await answerBalance(ctx, it.customer);
      return;
    case "report":
      await answerReport(ctx, it.period);
      return;
    case "ask":
      try {
        await answerQuestion(ctx, it, text);
      } catch (err) {
        console.error("ai answer failed", err);
        await ctx.reply({ type: "text", text: "Sorry, I couldn't work that out just now. Try *sales this week* or *who owes us*." });
      }
      return;

    case "help":
      await ctx.reply({ type: "text", text: HELP(user.name.split(" ")[0], business.name) });
      return;

    case "unclear":
      await ctx.reply({
        type: "text",
        text: it.reply ?? (ctx.ai ? "Sorry, I didn't understand. Could you say it another way?" : "Sorry, I didn't understand. Try *stock cement*, *price rebar*, *sales today* or *help*."),
      });
  }
}
