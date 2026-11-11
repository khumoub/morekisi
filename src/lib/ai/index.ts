import { ClaudeProvider } from "./claude";
import { DeepSeekProvider } from "./deepseek";
import { OpenAIProvider } from "./openai";
import type { LlmProvider } from "./provider";

export * from "./provider";

let cached: LlmProvider | null | undefined;

/**
 * The configured provider, or null when no AI is set up (the bot then falls back to simple
 * keyword commands so it still works in development and if the AI provider is down).
 *
 *   AI_PROVIDER=claude  ANTHROPIC_API_KEY=…  [AI_MODEL=claude-opus-5-5]
 *   AI_PROVIDER=openai  OPENAI_API_KEY=…     AI_MODEL=<model name>
 *   AI_PROVIDER=deepseek DEEPSEEK_API_KEY=… [AI_MODEL=deepseek-chat]
 */
export function getProvider(env: Record<string, string | undefined> = process.env): LlmProvider | null {
  if (cached !== undefined) return cached;
  const provider = (
    env.AI_PROVIDER ??
    (env.ANTHROPIC_API_KEY ? "claude" : env.OPENAI_API_KEY ? "openai" : env.DEEPSEEK_API_KEY ? "deepseek" : "")
  ).toLowerCase();

  if (provider === "claude") {
    cached = new ClaudeProvider(env.AI_MODEL || "claude-opus-5-5", env.ANTHROPIC_API_KEY);
  } else if (provider === "openai") {
    if (!env.AI_MODEL) throw new Error("AI_PROVIDER=openai needs AI_MODEL set to the OpenAI model to use");
    cached = new OpenAIProvider(env.AI_MODEL, env.OPENAI_API_KEY);
  } else if (provider === "deepseek") {
    cached = new DeepSeekProvider(env.AI_MODEL || "deepseek-chat", env.DEEPSEEK_API_KEY);
  } else {
    cached = null;
  }
  return cached;
}
