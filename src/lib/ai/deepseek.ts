import OpenAI from "openai";
import { AiUnavailableError, type JsonRequest, type LlmProvider, type TextRequest } from "./provider";

/**
 * DeepSeek adapter. DeepSeek's API is OpenAI-compatible (chat completions at api.deepseek.com).
 * It offers JSON mode (`response_format: json_object`) but not schema-enforced output, so the
 * schema is included in the instructions and the caller validates the result (interpret() does,
 * with zod) — anything that doesn't match is rejected, never guessed at.
 */
export class DeepSeekProvider implements LlmProvider {
  readonly name = "deepseek";
  private client: OpenAI;

  constructor(
    private model = "deepseek-chat",
    apiKey?: string,
    opts: { baseURL?: string; fetch?: typeof fetch } = {},
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: opts.baseURL ?? "https://api.deepseek.com",
      timeout: 30_000,
      maxRetries: 2,
      ...(opts.fetch && { fetch: opts.fetch }),
    });
  }

  async json(req: JsonRequest): Promise<unknown> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content:
            `${req.instructions}\n\n${req.shopContext}\n\n` +
            `Reply with a single JSON object (no other text) that matches this JSON schema exactly — ` +
            `every property present, null where a value doesn't apply:\n${JSON.stringify(req.schema)}`,
        },
        { role: "user", content: req.input },
      ],
    });
    const choice = res.choices[0];
    if (choice?.finish_reason === "length") throw new AiUnavailableError("Model output was cut off", "truncated");
    if (choice?.finish_reason === "content_filter") throw new AiUnavailableError("Model declined the request", "refusal");
    const text = choice?.message?.content;
    if (!text) throw new AiUnavailableError("Model returned no text", "invalid");
    try {
      return JSON.parse(text);
    } catch {
      throw new AiUnavailableError("Model returned invalid JSON", "invalid");
    }
  }

  async text(req: TextRequest): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1000,
      messages: [
        { role: "system", content: req.instructions },
        { role: "user", content: req.input },
      ],
    });
    const text = res.choices[0]?.message?.content;
    if (!text) throw new AiUnavailableError("Model returned no text", "invalid");
    return text.trim();
  }
}
