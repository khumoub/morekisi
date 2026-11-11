import type { InboundMessage } from "@/lib/whatsapp/inbound";
import type { LlmProvider } from "@/lib/ai/provider";
import { toE164 } from "@/lib/phone";
import { handleOffice } from "@/lib/office";
import { handleStore } from "@/lib/store";
import type { Context, Messenger, Party, Repo, WaAccount } from "./types";

export type HandleOutcome =
  | "unknown_number" // message to a number no shop has connected
  | "duplicate" // Meta retry of a message we already processed
  | "human_mode" // a person is handling this conversation; bot stays quiet
  | "office"
  | "store";

export interface EngineDeps {
  repo: Repo;
  messengerFor: (account: WaAccount) => Messenger;
  ai: LlmProvider | null;
  now?: () => Date;
}

/**
 * Entry point for every inbound WhatsApp message:
 * find the shop → who is writing (staff or customer) → log → route to back office or storefront.
 */
export async function handleInbound(deps: EngineDeps, message: InboundMessage): Promise<HandleOutcome> {
  const { repo } = deps;
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

  const conversation = await repo.getOrCreateConversation(business.id, message.from, party);
  const isNew = await repo.logInbound(business.id, message, party, conversation.id);
  if (!isNew) return "duplicate";
  await repo.updateConversation(conversation.id, { inbound: true });

  if (conversation.mode === "human" && party.kind === "customer") return "human_mode";

  const messenger = deps.messengerFor(account);
  const ctx: Context = {
    repo,
    business,
    conversation,
    party,
    message,
    ai: deps.ai,
    now: deps.now?.() ?? new Date(),
    reply: async (msg) => {
      const result = await messenger.send(message.from, msg);
      await repo.logOutbound(business.id, conversation.id, message.from, msg, result.messageId);
    },
    replyFile: async (file, caption) => {
      const result = await messenger.sendFile(message.from, file, caption);
      await repo.logOutbound(
        business.id,
        conversation.id,
        message.from,
        { type: "document", link: result.url ?? "", filename: file.filename, caption },
        result.messageId,
      );
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
