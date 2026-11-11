import type { InboundMessage } from "@/lib/whatsapp/inbound";
import type { OutboundMessage } from "@/lib/whatsapp/outbound";
import type { LlmProvider } from "@/lib/ai/provider";
import type { InvoiceData } from "@/lib/pdf/invoice";

export type Role = "owner" | "manager" | "staff";

export interface Business {
  id: string;
  name: string;
  welcomeMessage: string | null;
}

export interface WaAccount {
  phoneNumberId: string;
  tokenSecretId: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  role: Role;
}

export interface Customer {
  id: string;
  name: string;
}

export type Party = { kind: "staff"; user: StaffUser } | { kind: "customer"; customer: Customer };

export interface ConversationState {
  /** Staff can test the storefront from their own phone with "/shop". */
  staffTestingShop?: boolean;
  /** Current storefront step, e.g. "awaiting_quote_items". */
  step?: string;
}

export interface Conversation {
  id: string;
  mode: "bot" | "human";
  state: ConversationState;
}

export interface ProductMatch {
  id: string;
  name: string;
  unit: string;
  price: number; // thebe
  onHand: number;
  available: number;
  reorderLevel: number;
  trackStock: boolean;
}

export interface Category {
  id: string;
  name: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  available: number;
}

export type PaymentMethod = "cash" | "card" | "orange_money" | "myzaka" | "smega" | "eft" | "credit";

export interface ShopSettings {
  vatRegistered: boolean;
  vatRateBp: number;
  pricesIncludeVat: boolean;
  maxDiscountBp: number;
  timezone: string;
}

export interface CustomerMatch {
  id: string;
  name: string;
  phone: string | null;
  score: number;
}

export interface PendingAction {
  kind: string;
  payload: unknown;
  expiresAt: Date;
}

export interface QuoteSummary {
  id: string;
  quoteNo: string;
  /** open | accepted | cancelled | expired (open but past its date) */
  status: string;
  total: number;
  validUntil: string;
  customerId: string | null;
  customerName: string | null;
  items: { description: string; qty: number; unitPrice: number; lineTotal: number }[];
}

export interface SalesSummary {
  count: number;
  revenue: number;
  vat: number;
  grossProfit: number;
  creditSales: number;
}

export interface StockLevel {
  productId: string;
  name: string;
  unit: string;
  available: number;
  reorderLevel: number;
  lowStock: boolean;
}

/** Everything the engine needs from the database. Implemented with Supabase in `supabase-repo.ts`. */
export interface Repo {
  findAccount(phoneNumberId: string): Promise<{ business: Business; account: WaAccount } | null>;
  /** Stores the inbound message. Returns false if this message id was already processed (Meta retries). */
  logInbound(businessId: string, msg: InboundMessage, party: Party | null, conversationId?: string): Promise<boolean>;
  findStaff(businessId: string, phoneE164: string): Promise<StaffUser | null>;
  getOrCreateCustomer(businessId: string, waId: string, profileName?: string): Promise<Customer>;
  getOrCreateConversation(businessId: string, waId: string, party: Party): Promise<Conversation>;
  updateConversation(
    conversationId: string,
    patch: { mode?: Conversation["mode"]; state?: ConversationState; inbound?: boolean },
  ): Promise<void>;
  logOutbound(
    businessId: string,
    conversationId: string,
    to: string,
    msg: OutboundMessage,
    waMessageId?: string,
  ): Promise<void>;
  /** Last messages of a conversation, oldest first. */
  recentMessages(conversationId: string, limit: number): Promise<{ direction: "in" | "out"; text: string }[]>;

  // Catalogue
  /** Fuzzy product search. `shopOnly` hides products not shown to customers (e.g. the Delivery service). */
  matchProducts(businessId: string, query: string, opts?: { shopOnly?: boolean }): Promise<ProductMatch[]>;
  listCategories(businessId: string): Promise<Category[]>;
  shopProducts(businessId: string, categoryId?: string): Promise<ShopProduct[]>;
  /** Active product names for the AI prompt (not services like Delivery). */
  catalogue(businessId: string): Promise<{ name: string; unit: string }[]>;
  stockLevels(productIds: string[]): Promise<StockLevel[]>;
  lowStock(businessId: string, limit: number): Promise<StockLevel[]>;
  shopSettings(businessId: string): Promise<ShopSettings>;

  // Customers
  matchCustomers(businessId: string, query: string): Promise<CustomerMatch[]>;
  createCustomer(businessId: string, name: string): Promise<Customer>;
  customerBalance(customerId: string): Promise<{ balance: number; creditLimit: number }>;
  topDebtors(businessId: string, limit: number): Promise<{ name: string; balance: number; oldestUnpaid: string | null }[]>;

  // Waiting for Confirm/Cancel (one per staff member)
  getPending(userId: string): Promise<PendingAction | null>;
  savePending(businessId: string, userId: string, kind: string, payload: unknown): Promise<void>;
  clearPending(userId: string): Promise<void>;

  // Writes (each one database transaction)
  createSale(input: {
    businessId: string;
    userId: string;
    customerId: string | null;
    method: PaymentMethod;
    items: { productId: string; qty: number; unitPrice: number | null }[];
  }): Promise<{ id: string; invoiceNo: string; total: number }>;
  recordPayment(input: {
    businessId: string;
    userId: string;
    customerId: string;
    amount: number;
    method: Exclude<PaymentMethod, "credit">;
  }): Promise<{ receiptNo: string }>;
  stockIn(input: {
    businessId: string;
    userId: string;
    productId: string;
    qty: number;
    unitCost: number | null;
    supplier: string | null;
  }): Promise<void>;
  invoiceData(saleId: string): Promise<InvoiceData>;

  // Quotations
  createQuote(input: {
    businessId: string;
    userId: string;
    customerId: string | null;
    customerName: string | null;
    items: { productId: string; qty: number; unitPrice: number | null }[];
  }): Promise<{ id: string; quoteNo: string; total: number; validUntil: string }>;
  quoteData(quoteId: string): Promise<InvoiceData>;
  findQuote(businessId: string, quoteNo: string): Promise<QuoteSummary | null>;
  convertQuote(input: { quoteId: string; userId: string; method: PaymentMethod }): Promise<{ id: string; invoiceNo: string; total: number }>;

  // Reports (read-only)
  salesSummary(businessId: string, from: Date, to: Date): Promise<SalesSummary>;
  topProducts(businessId: string, from: Date, to: Date, limit: number): Promise<{ name: string; qty: number; revenue: number }[]>;
}

/** A file to send on WhatsApp (uploaded to Meta, then sent as a document). */
export interface OutboundFile {
  data: Buffer;
  filename: string;
  mimeType: string;
}

/** Sends WhatsApp messages from the shop's number. */
export interface Messenger {
  send(to: string, msg: OutboundMessage): Promise<{ ok: boolean; messageId?: string }>;
  /** `url`, when returned, is stored with the logged message (the chat simulator returns a data: URL). */
  sendFile(to: string, file: OutboundFile, caption?: string): Promise<{ ok: boolean; messageId?: string; url?: string }>;
}

export interface Context {
  repo: Repo;
  business: Business;
  conversation: Conversation;
  party: Party;
  message: InboundMessage;
  /** The AI, or null when not configured (simple keyword commands still work). */
  ai: LlmProvider | null;
  now: Date;
  /** Sends to the person who wrote, and logs it. */
  reply: (msg: OutboundMessage) => Promise<void>;
  /** Sends a file (e.g. invoice PDF) to the person who wrote, and logs it. */
  replyFile: (file: OutboundFile, caption?: string) => Promise<void>;
}
