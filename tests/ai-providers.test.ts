import { describe, expect, it, vi } from "vitest";

describe("provider selection", () => {
  async function pick(env: Record<string, string>) {
    vi.resetModules();
    const { getProvider } = await import("@/lib/ai");
    return getProvider(env)?.name ?? null;
  }
  it("picks the provider named in AI_PROVIDER", async () => {
    expect(await pick({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "x" })).toBe("deepseek");
    expect(await pick({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "x" })).toBe("claude");
    expect(await pick({ AI_PROVIDER: "openai", OPENAI_API_KEY: "x", AI_MODEL: "m" })).toBe("openai");
  });
  it("falls back to whichever key is present, or none", async () => {
    expect(await pick({ DEEPSEEK_API_KEY: "x" })).toBe("deepseek");
    expect(await pick({ AI_PROVIDER: "none" })).toBeNull();
  });
  it("requires a model name for OpenAI", async () => {
    await expect(pick({ AI_PROVIDER: "openai", OPENAI_API_KEY: "x" })).rejects.toThrow(/AI_MODEL/);
  });
});

describe("DeepSeek adapter", () => {
  it("sends JSON mode with the schema in the instructions, and parses the reply", async () => {
    const { DeepSeekProvider } = await import("@/lib/ai/deepseek");
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) });
      return new Response(
        JSON.stringify({ id: "1", object: "chat.completion", created: 0, model: "deepseek-chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"intent":"help"}' } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const p = new DeepSeekProvider("deepseek-chat", "test-key", { baseURL: "http://deepseek.test", fetch: fetchMock as typeof fetch });
    const out = await p.json({ instructions: "INSTR", shopContext: "SHOP", input: "hi", schemaName: "x", schema: { type: "object" } });
    expect(out).toEqual({ intent: "help" });
    expect(seen[0].url).toBe("http://deepseek.test/chat/completions");
    expect(seen[0].body.response_format).toEqual({ type: "json_object" });
    const system = (seen[0].body.messages as { role: string; content: string }[])[0].content;
    expect(system).toContain("INSTR");
    expect(system).toContain("SHOP");
    expect(system).toContain('{"type":"object"}');
  });

  it("reports a cut-off reply instead of using it", async () => {
    const { DeepSeekProvider } = await import("@/lib/ai/deepseek");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "1", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", content: '{"inte' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const p = new DeepSeekProvider("deepseek-chat", "test-key", { baseURL: "http://deepseek.test", fetch: fetchMock as typeof fetch });
    await expect(p.json({ instructions: "", shopContext: "", input: "", schemaName: "x", schema: {} })).rejects.toThrow(/cut off/);
  });
});
