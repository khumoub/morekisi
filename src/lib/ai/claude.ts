import Anthropic from "@anthropic-ai/sdk";
import { AiUnavailableError, type JsonRequest, type LlmProvider, type TextRequest } from "./provider";

/**
 * Claude adapter.
 * - Structured outputs (`output_config.format`) guarantee the JSON matches our schema.
 * - Low effort: this is extraction/classification, where low effort holds quality and keeps
 *   WhatsApp replies fast and cheap.
 * - Server-side refusal fallback (`fallbacks: "default"`) so a rare safety decline is retried
 *   on a fallback model inside the same call instead of failing the message.
 * - The instructions and shop catalogue are sent as stable system blocks with a cache
 *   breakpoint, so repeated messages from the same shop reuse the cached prefix.
 */
export class ClaudeProvider implements LlmProvider {
  readonly name = "claude";
  private client: Anthropic;

  constructor(
    private model = "claude-opus-5-5",
    apiKey?: string,
  ) {
    // WhatsApp users are waiting: fail fast rather than the SDK's 10-minute default.
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  async json(req: JsonRequest): Promise<unknown> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: req.schema } },
      system: [
        { type: "text", text: req.instructions },
        { type: "text", text: req.shopContext, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: req.input }],
    });
    const text = this.finalText(res);
    try {
      return JSON.parse(text);
    } catch {
      throw new AiUnavailableError("Model returned invalid JSON", "invalid");
    }
  }

  async text(req: TextRequest): Promise<string> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: req.instructions }],
      messages: [{ role: "user", content: req.input }],
    });
    return this.finalText(res).trim();
  }

  private finalText(res: Anthropic.Beta.BetaMessage): string {
    if (res.stop_reason === "refusal") throw new AiUnavailableError("Model declined the request", "refusal");
    if (res.stop_reason === "max_tokens") throw new AiUnavailableError("Model output was cut off", "truncated");
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) throw new AiUnavailableError("Model returned no text", "invalid");
    return text;
  }
}
