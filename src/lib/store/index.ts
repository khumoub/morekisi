import { formatPula } from "@/lib/money";
import type { Context, ShopProduct } from "@/lib/engine/types";

/**
 * Storefront: messages from customers (and staff testing with /shop).
 * Week 1: welcome menu, catalogue browsing, product questions answered from the database,
 * quote requests and "talk to a person" handover. Cart and checkout arrive in week 5.
 */

export const IDS = {
  browse: "store:browse",
  quote: "store:quote",
  human: "store:human",
  category: (id: string) => `cat:${id}`,
} as const;

type StoreIntent =
  | { kind: "menu" }
  | { kind: "browse" }
  | { kind: "category"; id: string }
  | { kind: "quote" }
  | { kind: "human" }
  | { kind: "ask_product"; query: string }
  | { kind: "back_to_office" }
  | { kind: "other"; text: string };

export function parseStoreMessage(ctx: Pick<Context, "message">): StoreIntent {
  const c = ctx.message.content;
  if (c.kind === "button" || c.kind === "list") {
    if (c.id === IDS.browse) return { kind: "browse" };
    if (c.id === IDS.quote) return { kind: "quote" };
    if (c.id === IDS.human) return { kind: "human" };
    if (c.id.startsWith("cat:")) return { kind: "category", id: c.id.slice(4) };
    return { kind: "menu" };
  }
  if (c.kind !== "text") return { kind: "menu" };

  const t = c.text.trim().toLowerCase().replace(/[?!.]+$/, "");
  if (t === "/office") return { kind: "back_to_office" };
  if (/^(hi|hello|hey|dumela|menu|start|good (morning|afternoon|evening))\b/.test(t) && t.split(/\s+/).length <= 4) {
    return { kind: "menu" };
  }
  if (/\b(talk to|speak to|call me|agent|human|person|someone)\b/.test(t)) return { kind: "human" };
  if (/^(browse|catalogue|catalog|products|shop)$/.test(t)) return { kind: "browse" };
  if (/^(quote|quotation)$/.test(t)) return { kind: "quote" };

  const ask = /^(?:do you (?:have|sell|stock)|is there|price (?:of|for)|how much (?:is|are|for)|o na le)\s+(?:any |a |an |the )?(.+)$/.exec(t);
  if (ask) return { kind: "ask_product", query: ask[1] };

  return { kind: "other", text: c.text };
}

function availability(p: ShopProduct): string {
  return p.available > 0 ? "✅ In stock" : "❌ Out of stock";
}

function productLine(p: ShopProduct): string {
  return `*${p.name}*: ${formatPula(p.price)} / ${p.unit} · ${availability(p)}`;
}

async function sendMenu(ctx: Context, intro?: string): Promise<void> {
  const welcome =
    ctx.business.welcomeMessage ??
    `Welcome to *${ctx.business.name}* 👋\nBrowse our products, ask for a quotation or chat to our team.`;
  await ctx.reply({
    type: "buttons",
    body: intro ? `${intro}\n\n${welcome}` : welcome,
    buttons: [
      { id: IDS.browse, title: "Browse products" },
      { id: IDS.quote, title: "Request a quote" },
      { id: IDS.human, title: "Talk to a person" },
    ],
  });
}

async function handoverToHuman(ctx: Context, text: string): Promise<void> {
  await ctx.repo.updateConversation(ctx.conversation.id, {
    mode: "human",
    state: { ...ctx.conversation.state, step: undefined },
  });
  await ctx.reply({ type: "text", text });
}

export async function handleStore(ctx: Context): Promise<void> {
  const { repo, business, conversation } = ctx;

  // A quote request: whatever the customer sends next is their list of items.
  if (conversation.state.step === "awaiting_quote_items" && ctx.message.content.kind === "text") {
    await handoverToHuman(
      ctx,
      `Thank you! 📝 We've sent your list to the *${business.name}* team. They'll reply here with a quotation shortly.`,
    );
    return;
  }

  const intent = parseStoreMessage(ctx);
  switch (intent.kind) {
    case "back_to_office":
      if (ctx.party.kind === "staff") {
        await repo.updateConversation(conversation.id, {
          state: { ...conversation.state, staffTestingShop: false, step: undefined },
        });
        await ctx.reply({ type: "text", text: "🗂️ Back in the back office. Send *help* to see what I can do." });
        return;
      }
      await sendMenu(ctx);
      return;

    case "menu":
      await sendMenu(ctx);
      return;

    case "browse": {
      const categories = await repo.listCategories(business.id);
      if (categories.length > 0) {
        await ctx.reply({
          type: "list",
          body: "What are you looking for?",
          button: "Categories",
          sections: [{ rows: categories.slice(0, 10).map((c) => ({ id: IDS.category(c.id), title: c.name })) }],
        });
        return;
      }
      await sendProducts(ctx, await repo.shopProducts(business.id), "Here's what we have:");
      return;
    }

    case "category":
      await sendProducts(ctx, await repo.shopProducts(business.id, intent.id), "Here's what we have:");
      return;

    case "ask_product": {
      const matches = await repo.matchProducts(business.id, intent.query, { shopOnly: true });
      if (matches.length === 0) {
        await ctx.reply({
          type: "buttons",
          body: `Sorry, I couldn't find "${intent.query}" in our catalogue. Our team can check for you.`,
          buttons: [
            { id: IDS.human, title: "Talk to a person" },
            { id: IDS.browse, title: "Browse products" },
          ],
        });
        return;
      }
      const lines = matches.map((m) =>
        productLine({ id: m.id, name: m.name, unit: m.unit, price: m.price, available: m.trackStock ? m.available : 1 }),
      );
      await ctx.reply({
        type: "buttons",
        body: lines.join("\n"),
        buttons: [
          { id: IDS.quote, title: "Request a quote" },
          { id: IDS.human, title: "Talk to a person" },
        ],
      });
      return;
    }

    case "quote":
      await repo.updateConversation(conversation.id, {
        state: { ...conversation.state, step: "awaiting_quote_items" },
      });
      await ctx.reply({
        type: "text",
        text:
          "📝 Please send the list of items and quantities you need in one message, for example:\n\n" +
          "_50 bags cement 42.5_\n_20 rebar 12mm_\n_delivery to Tlokweng_",
      });
      return;

    case "human":
      await handoverToHuman(
        ctx,
        `👤 A member of the *${business.name}* team will reply to you here shortly.`,
      );
      return;

    case "other":
      await sendMenu(ctx, "Sorry, I didn't quite get that 🙏");
  }
}

async function sendProducts(ctx: Context, products: ShopProduct[], intro: string): Promise<void> {
  if (products.length === 0) {
    await ctx.reply({ type: "text", text: "There are no products in this section right now." });
    return;
  }
  const shown = products.slice(0, 10);
  const more = products.length > shown.length ? `\n…and ${products.length - shown.length} more.` : "";
  await ctx.reply({
    type: "buttons",
    body: `${intro}\n\n${shown.map(productLine).join("\n")}${more}`,
    buttons: [
      { id: IDS.quote, title: "Request a quote" },
      { id: IDS.human, title: "Talk to a person" },
    ],
  });
}
