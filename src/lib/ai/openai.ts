import OpenAI from "openai";
import { AiUnavailableError, type JsonRequest, type LlmProvider, type TextRequest } from "./provider";

/**
 * OpenAI adapter (Responses API with strict JSON-schema output).
 * The model name must be configured explicitly via OPENAI_MODEL.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(
    private model: string,
    apiKey?: string,
  ) {
    this.client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  async json(req: JsonRequest): Promise<unknown> {
    const res = await this.client.responses.create({
      model: this.model,
      instructions: `${req.instructions}\n\n${req.shopContext}`,
      input: req.input,
      text: { format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true } },
    });
    if (res.status === "incomplete") throw new AiUnavailableError("Model output was cut off", "truncated");
    const text = res.output_text;
    if (!text) throw new AiUnavailableError("Model returned no text (possibly a refusal)", "refusal");
    try {
      return JSON.parse(text);
    } catch {
      throw new AiUnavailableError("Model returned invalid JSON", "invalid");
    }
  }

  async text(req: TextRequest): Promise<string> {
    const res = await this.client.responses.create({
      model: this.model,
      instructions: req.instructions,
      input: req.input,
    });
    if (!res.output_text) throw new AiUnavailableError("Model returned no text", "invalid");
    return res.output_text.trim();
  }
}
