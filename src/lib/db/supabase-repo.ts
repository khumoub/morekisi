import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentText, type InboundMessage } from "@/lib/whatsapp/inbound";
import type { OutboundMessage } from "@/lib/whatsapp/outbound";
import type { Conversation, ConversationState, Party, ProductMatch, Repo } from "@/lib/engine/types";
import type { InvoiceData } from "@/lib/pdf/invoice";

const UNIQUE_VIOLATION = "23505";

function fail(op: string, error: { message: string } | null): never {
  throw new Error(`${op}: ${error?.message ?? "unknown error"}`);
}

function outboundText(msg: OutboundMessage): string {
  switch (msg.type) {
    case "text":
      return msg.text;
    case "buttons":
    case "list":
    case "location_request":
      return msg.body;
    case "document":
      return `[document ${msg.filename}]`;
    case "template":
      return `[template ${msg.name}]`;
  }
}

/** The engine's Repo, backed by Supabase with the service-role client. */
export function supabaseRepo(db: SupabaseClient): Repo {
  return {
    async findAccount(phoneNumberId) {
      const { data, error } = await db
        .from("wa_accounts")
        .select("phone_number_id, token_secret_id, businesses(id, name, welcome_message)")
        .eq("phone_number_id", phoneNumberId)
        .eq("active", true)
        .maybeSingle();
      if (error) fail("findAccount", error);
      if (!data) return null;
      const b = data.businesses as unknown as { id: string; name: string; welcome_message: string | null };
      return {
        business: { id: b.id, name: b.name, welcomeMessage: b.welcome_message },
        account: { phoneNumberId: data.phone_number_id, tokenSecretId: data.token_secret_id },
      };
    },

    async logInbound(businessId, msg: InboundMessage, party: Party | null, conversationId?: string) {
      const { error } = await db.from("wa_messages").insert({
        wa_message_id: msg.messageId,
        business_id: businessId,
        conversation_id: conversationId ?? null,
        user_id: party?.kind === "staff" ? party.user.id : null,
        direction: "in",
        phone: msg.from,
        body: contentText(msg.content),
        payload: msg.raw,
      });
      if (error?.code === UNIQUE_VIOLATION) return false;
      if (error) fail("logInbound", error);
      return true;
    },

    async findStaff(businessId, phoneE164) {
      const { data, error } = await db
        .from("business_users")
        .select("id, name, role")
        .eq("business_id", businessId)
        .eq("phone", phoneE164)
        .eq("active", true)
        .maybeSingle();
      if (error) fail("findStaff", error);
      return data;
    },

    async getOrCreateCustomer(businessId, waId, profileName) {
      const existing = await db
        .from("customers")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("wa_id", waId)
        .maybeSingle();
      if (existing.error) fail("getOrCreateCustomer", existing.error);
      if (existing.data) {
        await db.from("customers").update({ last_seen_at: new Date().toISOString() }).eq("id", existing.data.id);
        return existing.data;
      }
      const created = await db
        .from("customers")
        .insert({
          business_id: businessId,
          wa_id: waId,
          phone: `+${waId}`,
          name: profileName?.trim() || `+${waId}`,
          source: "whatsapp",
          last_seen_at: new Date().toISOString(),
        })
        .select("id, name")
        .single();
      if (created.error?.code === UNIQUE_VIOLATION) {
        // Two messages from a new customer arrived at once; the other request created the row.
        const again = await db
          .from("customers")
          .select("id, name")
          .eq("business_id", businessId)
          .eq("wa_id", waId)
          .single();
        if (again.error) fail("getOrCreateCustomer", again.error);
        return again.data;
      }
      if (created.error) fail("getOrCreateCustomer", created.error);
      return created.data;
    },

    async getOrCreateConversation(businessId, waId, party) {
      const { data, error } = await db
        .from("conversations")
        .upsert(
          {
            business_id: businessId,
            wa_id: waId,
            customer_id: party.kind === "customer" ? party.customer.id : null,
            user_id: party.kind === "staff" ? party.user.id : null,
          },
          { onConflict: "business_id,wa_id", ignoreDuplicates: false },
        )
        .select("id, mode, state")
        .single();
      if (error) fail("getOrCreateConversation", error);
      return { id: data.id, mode: data.mode, state: (data.state ?? {}) as ConversationState } satisfies Conversation;
    },

    async updateConversation(conversationId, patch) {
      const now = new Date().toISOString();
      const update: Record<string, unknown> = { updated_at: now };
      if (patch.mode) update.mode = patch.mode;
      if (patch.state) update.state = patch.state;
      if (patch.inbound) update.last_inbound_at = now;
      const { error } = await db.from("conversations").update(update).eq("id", conversationId);
      if (error) fail("updateConversation", error);
      if (patch.inbound) {
        // unread counter for the inbox; a failure here must not break message handling
        await db.rpc("increment_unread", { p_conversation: conversationId }).then(() => undefined, () => undefined);
      }
    },

    async logOutbound(businessId, conversationId, to, msg, waMessageId) {
      const { error } = await db.from("wa_messages").insert({
        wa_message_id: waMessageId ?? null,
        business_id: businessId,
        conversation_id: conversationId,
        direction: "out",
        phone: to,
        body: outboundText(msg),
        payload: msg,
        status: waMessageId ? "sent" : "failed",
      });
      if (error) fail("logOutbound", error);
    },

    async matchProducts(businessId, query, opts) {
      const { data: matches, error } = await db.rpc("match_products", {
        p_business: businessId,
        p_query: query,
        p_limit: 5,
      });
      if (error) fail("matchProducts", error);
      const ids = (matches as { id: string }[]).map((m) => m.id);
      if (ids.length === 0) return [];

      const [products, stock] = await Promise.all([
        db.from("products").select("id, name, unit, sell_price, show_in_shop, track_stock").in("id", ids),
        db.from("product_stock").select("product_id, on_hand, available, reorder_level").in("product_id", ids),
      ]);
      if (products.error) fail("matchProducts/products", products.error);
      if (stock.error) fail("matchProducts/stock", stock.error);

      const byId = new Map(products.data.map((p) => [p.id, p]));
      const stockById = new Map(stock.data.map((s) => [s.product_id, s]));
      return ids
        .map((id): (ProductMatch & { showInShop: boolean }) | null => {
          const p = byId.get(id);
          const s = stockById.get(id);
          if (!p) return null;
          return {
            id,
            name: p.name,
            unit: p.unit,
            price: Number(p.sell_price),
            onHand: Number(s?.on_hand ?? 0),
            available: Number(s?.available ?? 0),
            reorderLevel: Number(s?.reorder_level ?? 0),
            trackStock: p.track_stock,
            showInShop: p.show_in_shop,
          };
        })
        .filter((m): m is ProductMatch & { showInShop: boolean } => m !== null && (!opts?.shopOnly || m.showInShop));
    },

    async listCategories(businessId) {
      const { data, error } = await db
        .from("categories")
        .select("id, name")
        .eq("business_id", businessId)
        .order("sort_order")
        .order("name");
      if (error) fail("listCategories", error);
      return data;
    },

    async shopProducts(businessId, categoryId) {
      const { data, error } = await db.rpc("shop_products", {
        p_business: businessId,
        p_category: categoryId ?? null,
      });
      if (error) fail("shopProducts", error);
      return (data as { id: string; name: string; unit: string; price: number; available: number }[]).map((p) => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        price: Number(p.price),
        available: Number(p.available),
      }));
    },

    async recentMessages(conversationId, limit) {
      const { data, error } = await db
        .from("wa_messages")
        .select("direction, body, created_at, id")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) fail("recentMessages", error);
      return data.reverse().map((m) => ({ direction: m.direction as "in" | "out", text: m.body ?? "" }));
    },

    async catalogue(businessId) {
      const { data, error } = await db
        .from("products")
        .select("name, unit")
        .eq("business_id", businessId)
        .eq("active", true)
        .eq("track_stock", true)
        .order("name")
        .limit(1000);
      if (error) fail("catalogue", error);
      return data;
    },

    async stockLevels(productIds) {
      if (productIds.length === 0) return [];
      const { data, error } = await db
        .from("product_stock")
        .select("product_id, name, unit, available, reorder_level, low_stock, track_stock")
        .in("product_id", productIds);
      if (error) fail("stockLevels", error);
      return data
        .filter((r) => r.track_stock)
        .map((r) => ({
          productId: r.product_id,
          name: r.name,
          unit: r.unit,
          available: Number(r.available),
          reorderLevel: Number(r.reorder_level),
          lowStock: Boolean(r.low_stock),
        }));
    },

    async lowStock(businessId, limit) {
      const { data, error } = await db
        .from("product_stock")
        .select("product_id, name, unit, available, reorder_level, low_stock")
        .eq("business_id", businessId)
        .eq("low_stock", true)
        .order("available")
        .limit(limit);
      if (error) fail("lowStock", error);
      return data.map((r) => ({
        productId: r.product_id,
        name: r.name,
        unit: r.unit,
        available: Number(r.available),
        reorderLevel: Number(r.reorder_level),
        lowStock: true,
      }));
    },

    async shopSettings(businessId) {
      const { data, error } = await db
        .from("businesses")
        .select("vat_registered, vat_rate_bp, prices_include_vat, max_discount_bp, timezone")
        .eq("id", businessId)
        .single();
      if (error) fail("shopSettings", error);
      return {
        vatRegistered: data.vat_registered,
        vatRateBp: data.vat_rate_bp,
        pricesIncludeVat: data.prices_include_vat,
        maxDiscountBp: data.max_discount_bp,
        timezone: data.timezone,
      };
    },

    async matchCustomers(businessId, query) {
      const { data, error } = await db.rpc("match_customers", { p_business: businessId, p_query: query, p_limit: 6 });
      if (error) fail("matchCustomers", error);
      return (data as { id: string; name: string; phone: string | null; score: number }[]).map((c) => ({ ...c, score: Number(c.score) }));
    },

    async createCustomer(businessId, name) {
      const { data, error } = await db
        .from("customers")
        .insert({ business_id: businessId, name, source: "manual" })
        .select("id, name")
        .single();
      if (error) fail("createCustomer", error);
      return data;
    },

    async customerBalance(customerId) {
      const { data, error } = await db
        .from("customer_balances")
        .select("balance, credit_limit")
        .eq("customer_id", customerId)
        .single();
      if (error) fail("customerBalance", error);
      return { balance: Number(data.balance), creditLimit: Number(data.credit_limit) };
    },

    async topDebtors(businessId, limit) {
      const { data, error } = await db
        .from("customer_balances")
        .select("name, balance, oldest_unpaid")
        .eq("business_id", businessId)
        .gt("balance", 0)
        .order("balance", { ascending: false })
        .limit(limit);
      if (error) fail("topDebtors", error);
      return data.map((d) => ({ name: d.name, balance: Number(d.balance), oldestUnpaid: d.oldest_unpaid }));
    },

    async getPending(userId) {
      const { data, error } = await db
        .from("pending_actions")
        .select("kind, payload, expires_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("getPending", error);
      return data ? { kind: data.kind, payload: data.payload, expiresAt: new Date(data.expires_at) } : null;
    },

    async savePending(businessId, userId, kind, payload) {
      const { error } = await db.from("pending_actions").upsert(
        {
          business_id: businessId,
          user_id: userId,
          kind,
          payload,
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) fail("savePending", error);
    },

    async clearPending(userId) {
      const { error } = await db.from("pending_actions").delete().eq("user_id", userId);
      if (error) fail("clearPending", error);
    },

    async createSale({ businessId, userId, customerId, method, items }) {
      const { data, error } = await db.rpc("create_sale", {
        p_business: businessId,
        p_user: userId,
        p_customer: customerId,
        p_method: method,
        p_items: items.map((i) => ({
          product_id: i.productId,
          qty: i.qty,
          ...(i.unitPrice !== null && { unit_price: i.unitPrice }),
        })),
        p_channel: "whatsapp",
      });
      if (error) fail("createSale", error);
      const sale = data as { id: string; invoice_no: string; total: number };
      return { id: sale.id, invoiceNo: sale.invoice_no, total: Number(sale.total) };
    },

    async recordPayment({ businessId, userId, customerId, amount, method }) {
      const { data, error } = await db.rpc("record_payment", {
        p_business: businessId,
        p_user: userId,
        p_customer: customerId,
        p_amount: amount,
        p_method: method,
      });
      if (error) fail("recordPayment", error);
      return { receiptNo: (data as { receipt_no: string }).receipt_no };
    },

    async stockIn({ businessId, userId, productId, qty, unitCost, supplier }) {
      const { error } = await db.rpc("stock_in", {
        p_business: businessId,
        p_user: userId,
        p_product: productId,
        p_qty: qty,
        p_unit_cost: unitCost,
        p_supplier: supplier,
      });
      if (error) fail("stockIn", error);
    },

    async invoiceData(saleId) {
      const { data, error } = await db.rpc("invoice_data", { p_sale: saleId });
      if (error) fail("invoiceData", error);
      return data as InvoiceData;
    },

    async salesSummary(businessId, from, to) {
      const { data, error } = await db.rpc("sales_summary", {
        p_business: businessId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });
      if (error) fail("salesSummary", error);
      const r = (data as Record<string, number>[])[0] ?? {};
      return {
        count: Number(r.sales_count ?? 0),
        revenue: Number(r.revenue ?? 0),
        vat: Number(r.vat ?? 0),
        grossProfit: Number(r.gross_profit ?? 0),
        creditSales: Number(r.credit_sales ?? 0),
      };
    },

    async topProducts(businessId, from, to, limit) {
      const { data, error } = await db.rpc("top_products", {
        p_business: businessId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_limit: limit,
      });
      if (error) fail("topProducts", error);
      return (data as { name: string; qty: number; revenue: number }[]).map((t) => ({
        name: t.name,
        qty: Number(t.qty),
        revenue: Number(t.revenue),
      }));
    },
  };
}
