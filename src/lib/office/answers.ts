import type { Interpretation } from "@/lib/ai/intent";
import { hasRole } from "@/lib/auth/roles";
import type { Context, ProductMatch } from "@/lib/engine/types";
import { PERIOD_LABEL, periodRange, type Period } from "@/lib/periods";
import { fmtQty, formatPula } from "./format";

/** Read-only intents: answered straight from the database, no confirmation needed. */

function stockLine(p: ProductMatch): string {
  if (!p.trackStock) return `• *${p.name}*: not stock-tracked`;
  const reserved = p.onHand - p.available;
  const warn = p.available <= p.reorderLevel ? " ⚠️ low" : "";
  const res = reserved > 0 ? ` (${fmtQty(reserved)} reserved for orders, ${fmtQty(p.available)} available)` : "";
  return `• *${p.name}*: ${fmtQty(p.onHand)} ${p.unit}${res}${warn}`;
}

export async function answerStockOrPrice(ctx: Context, kind: "stock" | "price", queries: string[]): Promise<void> {
  if (queries.length === 0) {
    await ctx.reply({ type: "text", text: kind === "stock" ? "Which product? e.g. *stock cement*" : "Which product? e.g. *price rebar 12mm*" });
    return;
  }
  const out: string[] = [];
  for (const q of queries.slice(0, 5)) {
    const matches = await ctx.repo.matchProducts(ctx.business.id, q);
    if (matches.length === 0) out.push(`• I couldn't find "${q}".`);
    else out.push(...matches.map((p) => (kind === "stock" ? stockLine(p) : `• *${p.name}*: ${formatPula(p.price)} / ${p.unit}`)));
  }
  await ctx.reply({ type: "text", text: [...new Set(out)].join("\n") });
}

export async function answerBalance(ctx: Context, customer: string | null): Promise<void> {
  const { repo, business } = ctx;
  if (!customer) {
    const debtors = await repo.topDebtors(business.id, 10);
    if (debtors.length === 0) {
      await ctx.reply({ type: "text", text: "🎉 Nobody owes the shop money right now." });
      return;
    }
    const total = debtors.reduce((t, d) => t + d.balance, 0);
    await ctx.reply({
      type: "text",
      text: ["💳 *Customers who owe the shop*", "", ...debtors.map((d) => `• ${d.name}: ${formatPula(d.balance)}`), "", `Top ${debtors.length} total: *${formatPula(total)}*`].join("\n"),
    });
    return;
  }
  const matches = await repo.matchCustomers(business.id, customer);
  if (matches.length === 0) {
    await ctx.reply({ type: "text", text: `I couldn't find a customer called *${customer}*.` });
    return;
  }
  const lines: string[] = [];
  for (const m of matches.slice(0, 5)) {
    const { balance, creditLimit } = await repo.customerBalance(m.id);
    lines.push(`• *${m.name}*: owes ${formatPula(balance)}${creditLimit > 0 ? ` (limit ${formatPula(creditLimit)})` : ""}`);
  }
  await ctx.reply({ type: "text", text: lines.join("\n") });
}

export async function answerReport(ctx: Context, period: Period | null): Promise<void> {
  const p = period ?? "today";
  const settings = await ctx.repo.shopSettings(ctx.business.id);
  const { from, to } = periodRange(p, ctx.now, settings.timezone);
  const [summary, top] = await Promise.all([
    ctx.repo.salesSummary(ctx.business.id, from, to),
    ctx.repo.topProducts(ctx.business.id, from, to, 3),
  ]);
  const canSeeProfit = ctx.party.kind === "staff" && hasRole(ctx.party.user.role, "manager");

  const lines = [
    `📊 *${PERIOD_LABEL[p]} at ${ctx.business.name}*`,
    "",
    `Sales: *${formatPula(summary.revenue)}* from ${summary.count} invoice${summary.count === 1 ? "" : "s"}`,
  ];
  if (summary.creditSales > 0) lines.push(`On credit: ${formatPula(summary.creditSales)}`);
  if (canSeeProfit) lines.push(`Gross profit: *${formatPula(summary.grossProfit)}*`);
  if (settings.vatRegistered) lines.push(`VAT collected: ${formatPula(summary.vat)}`);
  if (top.length) lines.push("", "Top sellers:", ...top.map((t) => `• ${t.name}: ${fmtQty(t.qty)} (${formatPula(t.revenue)})`));
  await ctx.reply({ type: "text", text: lines.join("\n") });
}

const ASK_INSTRUCTIONS = `You are Morekisi, the back-office assistant of a small shop in Botswana, answering a staff member on WhatsApp.
Answer ONLY from the shop data provided. Never guess or invent figures. If the data doesn't answer the question, say what you can tell from it and what you can't.
Money is in Pula, written like P1,234.50. Keep it short: at most 6 lines, plain WhatsApp text, *bold* for key numbers, no tables or headings.
Reply in the language the staff member used (English or Setswana).`;

/** Free-form business questions: the AI answers from a snapshot of real numbers we give it. */
export async function answerQuestion(ctx: Context, it: Interpretation, originalText: string): Promise<void> {
  if (!ctx.ai) {
    await ctx.reply({ type: "text", text: "I can't answer open questions yet. Try *sales today*, *stock cement* or *who owes us*." });
    return;
  }
  const { repo, business } = ctx;
  const settings = await repo.shopSettings(business.id);
  const canSeeProfit = ctx.party.kind === "staff" && hasRole(ctx.party.user.role, "manager");

  const periods: Period[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"];
  const summaries = await Promise.all(
    periods.map(async (p) => {
      const { from, to } = periodRange(p, ctx.now, settings.timezone);
      const s = await repo.salesSummary(business.id, from, to);
      return `${PERIOD_LABEL[p]}: sales ${formatPula(s.revenue)} (${s.count} invoices)${canSeeProfit ? `, gross profit ${formatPula(s.grossProfit)}` : ""}, on credit ${formatPula(s.creditSales)}`;
    }),
  );
  const month = periodRange("this_month", ctx.now, settings.timezone);
  const lastMonth = periodRange("last_month", ctx.now, settings.timezone);
  const [topThis, topLast, low, debtors] = await Promise.all([
    repo.topProducts(business.id, month.from, month.to, 10),
    repo.topProducts(business.id, lastMonth.from, lastMonth.to, 10),
    repo.lowStock(business.id, 15),
    repo.topDebtors(business.id, 10),
  ]);

  const data = [
    `Shop: ${business.name}. Now: ${ctx.now.toISOString()}.`,
    "Sales by period:",
    ...summaries.map((s) => `- ${s}`),
    "Best sellers this month (qty, sales):",
    ...(topThis.length ? topThis.map((t) => `- ${t.name}: ${fmtQty(t.qty)}, ${formatPula(t.revenue)}`) : ["- none yet"]),
    "Best sellers last month:",
    ...(topLast.length ? topLast.map((t) => `- ${t.name}: ${fmtQty(t.qty)}, ${formatPula(t.revenue)}`) : ["- none"]),
    "Low stock (available / reorder level):",
    ...(low.length ? low.map((s) => `- ${s.name}: ${fmtQty(s.available)} ${s.unit} / ${fmtQty(s.reorderLevel)}`) : ["- nothing low"]),
    "Customers who owe money:",
    ...(debtors.length ? debtors.map((d) => `- ${d.name}: ${formatPula(d.balance)}`) : ["- nobody"]),
    ...(canSeeProfit ? [] : ["(This staff member may not see profit or cost figures.)"]),
  ].join("\n");

  const answer = await ctx.ai.text({
    instructions: ASK_INSTRUCTIONS,
    input: `Shop data:\n${data}\n\nQuestion: ${it.question ?? originalText}`,
  });
  await ctx.reply({ type: "text", text: answer });
}
