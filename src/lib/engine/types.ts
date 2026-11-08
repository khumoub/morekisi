import type { InboundMessage } from "@/lib/whatsapp/inbound";
import type { OutboundMessage } from "@/lib/whatsapp/outbound";

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

/** Everything the engine needs from the database. Implemented with Supabase in `supabase-repo.ts`. */
export interface Repo {
  findAccount(phoneNumberId: string): Promise<{ business: Business; account: WaAccount } | null>;
  /** Stores the inbound message. Returns false if this message id was already processed (Meta retries). */
  logInbound(businessId: string, msg: InboundMessage, party: Party | null): Promise<boolean>;
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
  /** Fuzzy product search. `shopOnly` hides products not shown to customers (e.g. the Delivery service). */
  matchProducts(businessId: string, query: string, opts?: { shopOnly?: boolean }): Promise<ProductMatch[]>;
  listCategories(businessId: string): Promise<Category[]>;
  shopProducts(businessId: string, categoryId?: string): Promise<ShopProduct[]>;
}

/** Sends a WhatsApp message from the shop's number. */
export type Send = (to: string, msg: OutboundMessage) => Promise<{ ok: boolean; messageId?: string }>;

export interface Context {
  repo: Repo;
  business: Business;
  conversation: Conversation;
  party: Party;
  message: InboundMessage;
  /** Sends to the person who wrote, and logs it. */
  reply: (msg: OutboundMessage) => Promise<void>;
}
