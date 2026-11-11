import type { Interpretation } from "@/lib/ai/intent";
import type { Context, PaymentMethod, ProductMatch } from "@/lib/engine/types";
import { parsePula } from "@/lib/money";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { fmtQty, formatPula, grandTotal, lineTotal, METHOD_LABEL, vatIncluded } from "./format";

/**
 * Write actions over WhatsApp: record_sale, record_payment, stock_in.
 *
 * draft → resolve products/customer (ask when ambiguous) → summary with Confirm/Cancel → execute.
 * The state between messages lives in pending_actions (one per staff member, expires in 15 min).
 */

interface ResolvedProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  available: number;
  trackStock: boolean;
}

interface DraftLine {
  text: string;
  qty: number;
  /** Price the person stated (sale: selling price, stock_in: cost), in thebe. */
  unitPrice: number | null;
  product: ResolvedProduct | null;
}

interface DraftCustomer {
  text: string;
  id: string | null;
  name: string | null;
  isNew: boolean;
}

export type Draft =
  | { kind: "sale"; lines: DraftLine[]; customer: DraftCustomer | null; method: PaymentMethod; methodDefaulted: boolean }
  | { kind: "payment"; customer: DraftCustomer | null; amount: number; method: Exclude<PaymentMethod, "credit"> }
  | { kind: "stock_in"; lines: DraftLine[]; supplier: string | null };

type Step =
  | { stage: "choose_product"; index: number; options: ResolvedProduct[] }
  | { stage: "choose_customer"; options: { id: string; name: string }[] }
  | { stage: "need_customer" }
  | { stage: "confirm"; summary: string };

export interface PendingPayload {
  draft: Draft;
  step: Step;
}

const toThebe = (pula: number | null) => (pula === null ? null : Math.round(pula * 100));
const toResolved = (m: ProductMatch): ResolvedProduct => ({
  id: m.id,
  name: m.name,
  unit: m.unit,
  price: m.price,
  available: m.available,
  trackStock: m.trackStock,
});

// ───────────────────────── Starting a draft from the AI's interpretation ─────────────────────────

export async function startDraft(ctx: Context, it: Interpretation): Promise<void> {
  if (it.intent === "record_sale" || it.intent === "stock_in") {
    if (it.items.length === 0) {
      await ctx.reply({ type: "text", text: "Which products? For example: *sold 20 cement and 5 rebar 12mm to Kabelo, cash*" });
      return;
    }
    const missingQty = it.items.find((i) => i.qty === null || i.qty <= 0);
    if (missingQty) {
      await ctx.reply({ type: "text", text: `How many *${missingQty.product}*? Please send the whole message again with quantities.` });
      return;
    }
    const lines: DraftLine[] = it.items.map((i) => ({ text: i.product, qty: i.qty!, unitPrice: toThebe(i.unit_price), product: null }));
    const draft: Draft =
      it.intent === "record_sale"
        ? {
            kind: "sale",
            lines,
            customer: it.customer ? { text: it.customer, id: null, name: null, isNew: false } : null,
            method: it.payment_method ?? "cash",
            methodDefaulted: it.payment_method === null,
          }
        : { kind: "stock_in", lines, supplier: it.supplier };
    await advance(ctx, draft);
    return;
  }

  if (it.intent === "record_payment") {
    const amount = toThebe(it.amount);
    if (!amount || amount <= 0) {
      await ctx.reply({ type: "text", text: "How much was paid? For example: *Kabelo paid P500 Orange Money*" });
      return;
    }
    const method = it.payment_method && it.payment_method !== "credit" ? it.payment_method : "cash";
    await advance(ctx, {
      kind: "payment",
      amount,
      method,
      customer: it.customer ? { text: it.customer, id: null, name: null, isNew: false } : null,
    });
  }
}

// ───────────────────────── Resolving, asking, summarising ─────────────────────────

async function save(ctx: Context, draft: Draft, step: Step) {
  if (ctx.party.kind !== "staff") return;
  await ctx.repo.savePending(ctx.business.id, ctx.party.user.id, draft.kind, { draft, step } satisfies PendingPayload);
}

async function clear(ctx: Context) {
  if (ctx.party.kind === "staff") await ctx.repo.clearPending(ctx.party.user.id);
}

/** Moves a draft forward: resolves what it can, asks about the first unclear thing, or asks to confirm. */
export async function advance(ctx: Context, draft: Draft): Promise<void> {
  const { repo, business } = ctx;

  // 1. Products
  if (draft.kind !== "payment") {
    for (let i = 0; i < draft.lines.length; i++) {
      const line = draft.lines[i];
      if (line.product) continue;
      const matches = draft.kind === "sale" || draft.kind === "stock_in" ? await repo.matchProducts(business.id, line.text) : [];
      const exact = matches.find((m) => m.name.toLowerCase() === line.text.toLowerCase());
      if (exact || matches.length === 1) {
        line.product = toResolved(exact ?? matches[0]);
        continue;
      }
      if (matches.length === 0) {
        await clear(ctx);
        await ctx.reply({
          type: "text",
          text: `I couldn't find *${line.text}* in your products. Check the spelling, or add it in the dashboard under Products, then send the message again.`,
        });
        return;
      }
      const options = matches.slice(0, 9).map(toResolved);
      await save(ctx, draft, { stage: "choose_product", index: i, options });
      await ctx.reply({
        type: "list",
        body: `Which one do you mean by *${line.text}*?`,
        button: "Choose product",
        sections: [{ rows: options.map((o, n) => ({ id: `pick:${n}`, title: o.name, description: `${formatPula(o.price)} / ${o.unit}` })) }],
      });
      return;
    }
  }

  // 2. Customer
  if (draft.kind !== "stock_in") {
    const c = draft.customer;
    if (c && !c.id && !c.isNew) {
      const matches = await repo.matchCustomers(business.id, c.text);
      const exact = matches.find((m) => m.name.toLowerCase() === c.text.toLowerCase());
      if (exact || (matches.length === 1 && matches[0].score >= 0.6)) {
        const pick = exact ?? matches[0];
        c.id = pick.id;
        c.name = pick.name;
      } else if (matches.length === 0) {
        if (draft.kind === "payment") {
          await clear(ctx);
          await ctx.reply({ type: "text", text: `I couldn't find a customer called *${c.text}*. Check the name and send it again.` });
          return;
        }
        c.isNew = true;
        c.name = titleCase(c.text);
      } else {
        const options = matches.slice(0, 9).map((m) => ({ id: m.id, name: m.name }));
        await save(ctx, draft, { stage: "choose_customer", options });
        const rows = options.map((o, n) => ({ id: `pick:${n}`, title: o.name }));
        if (draft.kind === "sale") rows.push({ id: "pick:new", title: `New: ${titleCase(c.text)}` });
        await ctx.reply({ type: "list", body: `Which customer is *${c.text}*?`, button: "Choose customer", sections: [{ rows }] });
        return;
      }
    }
    const needsCustomer = draft.kind === "payment" || (draft.kind === "sale" && draft.method === "credit");
    if (needsCustomer && !draft.customer) {
      await save(ctx, draft, { stage: "need_customer" });
      await ctx.reply({
        type: "text",
        text: draft.kind === "payment" ? "Which customer paid? Reply with their name." : "Who is this credit sale for? Reply with the customer's name.",
      });
      return;
    }
  }

  // 3. Rules
  if (draft.kind === "sale") {
    const settings = await repo.shopSettings(business.id);
    const role = ctx.party.kind === "staff" ? ctx.party.user.role : "staff";
    for (const l of draft.lines) {
      if (l.unitPrice === null || !l.product || l.unitPrice >= l.product.price) continue;
      const discountBp = ((l.product.price - l.unitPrice) / l.product.price) * 10000;
      if (discountBp > settings.maxDiscountBp && role === "staff") {
        await clear(ctx);
        await ctx.reply({
          type: "text",
          text: `A price of ${formatPula(l.unitPrice)} for *${l.product.name}* is more than ${settings.maxDiscountBp / 100}% below ${formatPula(l.product.price)}. Only the owner or a manager can give that discount.`,
        });
        return;
      }
    }
  }

  // 4. Summary → Confirm / Cancel
  const summary = await summarise(ctx, draft);
  await save(ctx, draft, { stage: "confirm", summary });
  await ctx.reply({
    type: "buttons",
    body: summary,
    buttons: [
      { id: "pa:yes", title: "✅ Confirm" },
      { id: "pa:no", title: "❌ Cancel" },
    ],
  });
}

async function summarise(ctx: Context, draft: Draft): Promise<string> {
  const { repo, business } = ctx;
  if (draft.kind === "sale") {
    const settings = await repo.shopSettings(business.id);
    const who = draft.customer?.name ?? "Cash customer";
    const lines = draft.lines.map((l) => {
      const price = l.unitPrice ?? l.product!.price;
      return `${fmtQty(l.qty)} × ${l.product!.name} @ ${formatPula(price)} = ${formatPula(lineTotal(l.qty, price))}`;
    });
    const itemsTotal = draft.lines.reduce((t, l) => t + lineTotal(l.qty, l.unitPrice ?? l.product!.price), 0);
    const total = grandTotal(itemsTotal, settings);
    const vat = vatIncluded(itemsTotal, settings);

    const notes: string[] = [];
    for (const l of draft.lines) {
      if (l.product!.trackStock && l.qty > l.product!.available) {
        notes.push(`⚠️ Only ${fmtQty(l.product!.available)} ${l.product!.unit} of ${l.product!.name} available`);
      }
    }
    if (draft.customer?.isNew) notes.push(`👤 New customer *${draft.customer.name}* will be added`);
    if (draft.method === "credit" && draft.customer?.id) {
      const { balance, creditLimit } = await repo.customerBalance(draft.customer.id);
      const after = balance + total;
      const over = creditLimit > 0 && after > creditLimit;
      notes.push(
        `${over ? "⚠️" : "💳"} ${draft.customer.name}'s balance will be ${formatPula(after)}${creditLimit > 0 ? ` (limit ${formatPula(creditLimit)})` : ""}${over ? " — over the limit" : ""}`,
      );
    }
    const method = `Payment: ${METHOD_LABEL[draft.method]}${draft.methodDefaulted ? ' _(say "credit", "card" or "orange money" to change)_' : ""}`;
    return [
      `🧾 *Sale — ${who}*`,
      "",
      ...lines,
      "",
      `*Total ${formatPula(total)}*${vat ? ` (incl. VAT ${formatPula(vat)})` : ""}`,
      method,
      ...(notes.length ? ["", ...notes] : []),
    ].join("\n");
  }

  if (draft.kind === "payment") {
    const { balance } = await repo.customerBalance(draft.customer!.id!);
    return [
      `💵 *Payment received — ${draft.customer!.name}*`,
      "",
      `Amount: *${formatPula(draft.amount)}*`,
      `Method: ${METHOD_LABEL[draft.method]}`,
      `Balance: ${formatPula(balance)} → *${formatPula(balance - draft.amount)}*`,
      ...(draft.amount > balance ? ["", "⚠️ This is more than they owe; the extra stays as credit on their account."] : []),
    ].join("\n");
  }

  const lines = draft.lines.map(
    (l) => `+${fmtQty(l.qty)} ${l.product!.unit} ${l.product!.name}${l.unitPrice !== null ? ` @ ${formatPula(l.unitPrice)} cost` : ""}`,
  );
  return [`📦 *Stock received${draft.supplier ? ` from ${draft.supplier}` : ""}*`, "", ...lines].join("\n");
}

// ───────────────────────── Answering a question the bot asked ─────────────────────────

/**
 * Handles replies to a pending step: list picks, typed numbers, a customer name, Confirm/Cancel.
 * Returns false if the message isn't an answer (then it's treated as a new message).
 */
export async function continuePending(ctx: Context, payload: PendingPayload, expired: boolean): Promise<boolean> {
  const c = ctx.message.content;
  const buttonId = c.kind === "button" || c.kind === "list" ? c.id : null;
  const text = c.kind === "text" ? c.text.trim() : "";
  const { draft, step } = payload;

  if (buttonId === "pa:no" || (step.stage === "confirm" && isNo(text))) {
    await clear(ctx);
    await ctx.reply({ type: "text", text: "❌ Cancelled. Nothing was saved." });
    return true;
  }

  if (expired) {
    if (buttonId?.startsWith("pa:") || buttonId?.startsWith("pick:") || (step.stage === "confirm" && isYes(text))) {
      await clear(ctx);
      await ctx.reply({ type: "text", text: "⌛ That expired (15 minutes) and wasn't saved. Please send it again." });
      return true;
    }
    return false;
  }

  switch (step.stage) {
    case "confirm":
      if (buttonId === "pa:yes" || isYes(text)) {
        await clear(ctx);
        await execute(ctx, draft);
        return true;
      }
      return false;

    case "choose_product": {
      const n = pickIndex(buttonId, text, step.options.length);
      if (n === null || draft.kind === "payment") return false;
      draft.lines[step.index].product = step.options[n];
      await advance(ctx, draft);
      return true;
    }

    case "choose_customer": {
      if (draft.kind === "stock_in" || !draft.customer) return false;
      if (buttonId === "pick:new" && draft.kind === "sale") {
        draft.customer = { ...draft.customer, isNew: true, name: titleCase(draft.customer.text) };
        await advance(ctx, draft);
        return true;
      }
      const n = pickIndex(buttonId, text, step.options.length);
      if (n === null) return false;
      draft.customer = { ...draft.customer, id: step.options[n].id, name: step.options[n].name };
      await advance(ctx, draft);
      return true;
    }

    case "need_customer":
      if (!text || draft.kind === "stock_in" || text.length > 60 || looksLikeAmount(text)) return false;
      draft.customer = { text, id: null, name: null, isNew: false };
      await advance(ctx, draft);
      return true;
  }
}

/** The AI understood "yes"/"no" in free words ("go for it", "leave it") for a pending action. */
export async function answerPending(ctx: Context, payload: PendingPayload, expired: boolean, yes: boolean): Promise<void> {
  if (!yes) {
    await clear(ctx);
    await ctx.reply({ type: "text", text: "❌ Cancelled. Nothing was saved." });
    return;
  }
  if (expired) {
    await clear(ctx);
    await ctx.reply({ type: "text", text: "⌛ That expired (15 minutes) and wasn't saved. Please send it again." });
    return;
  }
  if (payload.step.stage !== "confirm") {
    await ctx.reply({ type: "text", text: "Please answer the question above first, or send *cancel*." });
    return;
  }
  await clear(ctx);
  await execute(ctx, payload.draft);
}

/** One-line description of what's waiting, for the AI's context. */
export function describePending(payload: PendingPayload): string {
  const s = payload.step;
  if (s.stage === "confirm") return s.summary.replace(/\n+/g, " | ");
  if (s.stage === "choose_product") return `asked which product they meant (options: ${s.options.map((o) => o.name).join("; ")})`;
  if (s.stage === "choose_customer") return `asked which customer they meant (options: ${s.options.map((o) => o.name).join("; ")})`;
  return "asked for the customer's name";
}

function pickIndex(buttonId: string | null, text: string, count: number): number | null {
  const raw = buttonId?.startsWith("pick:") ? buttonId.slice(5) : /^\d{1,2}$/.test(text) ? String(Number(text) - 1) : null;
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < count ? n : null;
}

export const isYes = (t: string) => /^(y|yes|yep|ok|okay|confirm|confirmed|ee|eya|go|go ahead|sure|correct|✅)\b/i.test(t.trim());
export const isNo = (t: string) => /^(n|no|nope|cancel|stop|nnyaa|nyaa|❌)\b/i.test(t.trim());

function titleCase(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ───────────────────────── Running a confirmed action ─────────────────────────

async function execute(ctx: Context, draft: Draft): Promise<void> {
  const { repo, business } = ctx;
  if (ctx.party.kind !== "staff") return;
  const userId = ctx.party.user.id;

  try {
    if (draft.kind === "sale") {
      let customerId = draft.customer?.id ?? null;
      if (draft.customer?.isNew) customerId = (await repo.createCustomer(business.id, draft.customer.name!)).id;

      const sale = await repo.createSale({
        businessId: business.id,
        userId,
        customerId,
        method: draft.method,
        items: draft.lines.map((l) => ({ productId: l.product!.id, qty: l.qty, unitPrice: l.unitPrice })),
      });

      let pdfSent = false;
      try {
        const data = await repo.invoiceData(sale.id);
        const pdf = await renderInvoicePdf(data);
        await ctx.replyFile({ data: pdf, filename: `${sale.invoiceNo}.pdf`, mimeType: "application/pdf" }, `${sale.invoiceNo} · ${formatPula(sale.total)}`);
        pdfSent = true;
      } catch (err) {
        console.error("invoice pdf failed", sale.id, err);
      }

      const levels = await repo.stockLevels(draft.lines.map((l) => l.product!.id));
      const low = levels.filter((s) => s.lowStock).map((s) => `⚠️ ${s.name} is down to ${fmtQty(s.available)} ${s.unit} (reorder level ${fmtQty(s.reorderLevel)})`);
      await ctx.reply({
        type: "text",
        text: [
          `✅ Saved as *${sale.invoiceNo}*: ${formatPula(sale.total)}.`,
          ...(pdfSent ? [] : ["The invoice PDF couldn't be created right now, but the sale is saved."]),
          ...low,
        ].join("\n"),
      });
      return;
    }

    if (draft.kind === "payment") {
      const { receiptNo } = await repo.recordPayment({
        businessId: business.id,
        userId,
        customerId: draft.customer!.id!,
        amount: draft.amount,
        method: draft.method,
      });
      const { balance } = await repo.customerBalance(draft.customer!.id!);
      await ctx.reply({
        type: "text",
        text: `✅ Payment saved (*${receiptNo}*): ${formatPula(draft.amount)} from ${draft.customer!.name}. Balance now *${formatPula(balance)}*.`,
      });
      return;
    }

    // Each line is its own transaction; if one fails, say exactly what was and wasn't saved.
    const done: string[] = [];
    for (const l of draft.lines) {
      try {
        await repo.stockIn({
          businessId: business.id,
          userId,
          productId: l.product!.id,
          qty: l.qty,
          unitCost: l.unitPrice,
          supplier: draft.supplier,
        });
        done.push(l.product!.name);
      } catch (err) {
        console.error("stock_in failed", l.product!.id, err);
        const notDone = draft.lines.filter((x) => !done.includes(x.product!.name)).map((x) => x.product!.name);
        await ctx.reply({
          type: "text",
          text: `⚠️ Stock was saved for: ${done.join(", ") || "nothing"}.
Not saved: ${notDone.join(", ")}. Please send those again.`,
        });
        return;
      }
    }
    const levels = await repo.stockLevels(draft.lines.map((l) => l.product!.id));
    await ctx.reply({
      type: "text",
      text: ["✅ Stock updated:", ...levels.map((s) => `• ${s.name}: ${fmtQty(s.available)} ${s.unit} available`)].join("\n"),
    });
  } catch (err) {
    console.error("execute failed", draft.kind, err);
    await ctx.reply({ type: "text", text: "⚠️ Sorry, that couldn't be saved. Nothing was recorded. Please try again." });
  }
}

/** Typed amounts like "P500" in a need_customer reply are not names. */
export function looksLikeAmount(text: string) {
  return parsePula(text) !== null;
}
