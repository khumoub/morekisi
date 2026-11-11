/**
 * The only interface the rest of Morekisi uses to talk to an LLM. Swapping providers means
 * adding an adapter here — nothing else changes.
 */

export interface JsonRequest {
  /** Fixed instructions — identical across requests so providers can cache them. */
  instructions: string;
  /** Per-shop context (catalogue etc.) — stable for a given shop, so also cacheable. */
  shopContext: string;
  /** The changing part: recent conversation + the new message. */
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface TextRequest {
  instructions: string;
  input: string;
}

export interface LlmProvider {
  readonly name: string;
  /** Returns JSON that matches `schema` (still validate it — the caller does). */
  json(req: JsonRequest): Promise<unknown>;
  /** Short free-text answer (used for business questions, from data we supply). */
  text(req: TextRequest): Promise<string>;
}

/** The model declined (safety) or the output was cut off — the caller replies gracefully. */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "refusal" | "truncated" | "invalid" | "error",
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}
