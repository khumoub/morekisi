import { formatPula } from "@/lib/money";
import type { Context, ProductMatch } from "@/lib/engine/types";

/**
 * Back office: messages from the shop's own staff.
 * Week 1 understands simple commands; the AI interpreter (week 3) replaces `parseCommand`
 * and adds the write intents (sales, stock in, payments) with Confirm/Cancel.
 */

type Command =
  | { kind: "help" }
  | { kind: "stock"; query: string }
  | { kind: "price"; query: string }
  | { kind: "test_shop" }
  | { kind: "unknown" };

export function parseCommand(text: string): Command {
  const t = text.trim().toLowerCase().replace(/[?!.]+$/, "");
  if (/^(hi|hello|dumela|help|menu|start)$/.test(t)) return { kind: "help" };
  if (t === "/shop") return { kind: "test_shop" };

  const stock =
    /^(?:stock|check stock|how (?:much|many)(?: of)?|do we have|re na le)\s+(.+?)(?:\s+(?:do we have|left|in stock))?$/.exec(t);
  if (stock) return { kind: "stock", query: stock[1] };

  const price = /^(?:price of|price|how much is|cost of)\s+(?:a |an |the )?(.+)$/.exec(t);
  if (price) return { kind: "price", query: price[1] };

  return { kind: "unknown" };
}

function stockLine(p: ProductMatch): string {
  if (!p.trackStock) return `• *${p.name}*: not stock-tracked`;
  const reserved = p.onHand - p.available;
  const warn = p.available <= p.reorderLevel ? " ⚠️ low" : "";
  const res = reserved > 0 ? ` (${reserved} reserved for orders, ${p.available} available)` : "";
  return `• *${p.name}*: ${p.onHand} ${p.unit}${res}${warn}`;
}

export async function handleOffice(ctx: Context): Promise<void> {
  const { message, party, repo, business } = ctx;
  const name = party.kind === "staff" ? party.user.name : "";
  const text =
    message.content.kind === "text"
      ? message.content.text
      : message.content.kind === "button" || message.content.kind === "list"
        ? message.content.title
        : "";

  if (!text) {
    await ctx.reply({
      type: "text",
      text: "I can only read text messages for now. Voice notes are coming soon 🎙️",
    });
    return;
  }

  const cmd = parseCommand(text);
  switch (cmd.kind) {
    case "help":
      await ctx.reply({
        type: "text",
        text:
          `Dumela ${name} 👋 This is the *${business.name}* back office.\n\n` +
          "You can ask me:\n" +
          "• *stock cement*: how much is in stock\n" +
          "• *price rebar 12mm*: selling price\n" +
          "• */shop*: see the shop the way your customers do\n\n" +
          "Recording sales, stock in and payments by message is coming next.",
      });
      return;

    case "test_shop":
      await repo.updateConversation(ctx.conversation.id, {
        state: { ...ctx.conversation.state, staffTestingShop: true },
      });
      await ctx.reply({
        type: "text",
        text: "🛍️ You're now seeing the shop as a customer. Send *hi* to start, or */office* to come back.",
      });
      return;

    case "stock":
    case "price": {
      const matches = await repo.matchProducts(business.id, cmd.query);
      if (matches.length === 0) {
        await ctx.reply({ type: "text", text: `I couldn't find a product matching "${cmd.query}".` });
        return;
      }
      const lines =
        cmd.kind === "stock"
          ? matches.map(stockLine)
          : matches.map((p) => `• *${p.name}*: ${formatPula(p.price)} / ${p.unit}`);
      await ctx.reply({ type: "text", text: lines.join("\n") });
      return;
    }

    case "unknown":
      await ctx.reply({
        type: "text",
        text: "Sorry, I didn't understand that yet. Try *stock cement*, *price rebar* or *help*.",
      });
  }
}
