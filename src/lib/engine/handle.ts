import type { InboundMessage } from "@/lib/whatsapp/inbound";
import { toE164 } from "@/lib/phone";
import { handleOffice } from "@/lib/office";
import { handleStore } from "@/lib/store";
import type { Context, Party, Repo, Send } from "./types";

export type HandleOutcome =
  | "unknown_number" // message to a number no shop has connected
  | "duplicate" // Meta retry of a message we already processed
  | "human_mode" // a person is handling this conversation; bot stays quiet
  | "office"
  | "store";

/**
 * Entry point for every inbound WhatsApp message:
 * find the shop → who is writing (staff or customer) → log → route to back office or storefront.
 */
export async function handleInbound(
  repo: Repo,
  sendFor: (account: { phoneNumberId: string; tokenSecretId: string | null }) => Send,
  message: InboundMessage,
): Promise<HandleOutcome> {
  const found = await repo.findAccount(message.phoneNumberId);
  if (!found) return "unknown_number";
  const { business, account } = found;

  const phone = toE164(`+${message.from}`);
  const staff = phone ? await repo.findStaff(business.id, phone) : null;

  const party: Party = staff
    ? { kind: "staff", user: staff }
    : {
        kind: "customer",
        customer: await repo.getOrCreateCustomer(business.id, message.from, message.profileName),
      };

  const isNew = await repo.logInbound(business.id, message, party);
  if (!isNew) return "duplicate";

  const conversation = await repo.getOrCreateConversation(business.id, message.from, party);
  await repo.updateConversation(conversation.id, { inbound: true });

  if (conversation.mode === "human" && party.kind === "customer") return "human_mode";

  const send = sendFor(account);
  const ctx: Context = {
    repo,
    business,
    conversation,
    party,
    message,
    reply: async (msg) => {
      const result = await send(message.from, msg);
      await repo.logOutbound(business.id, conversation.id, message.from, msg, result.messageId);
    },
  };

  const asShop = party.kind === "customer" || conversation.state.staffTestingShop === true;
  if (asShop) {
    await handleStore(ctx);
    return "store";
  }
  await handleOffice(ctx);
  return "office";
}
