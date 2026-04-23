import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getLLM", () => {
  it("defaults to OpenAI when LLM_PROVIDER is unset", async () => {
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
    const { getLLM } = await import("@/lib/llm");
    const cfg = getLLM();
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-4o");
  });

  it("returns Groq config when LLM_PROVIDER=groq and GROQ_API_KEY is set", async () => {
    vi.stubEnv("LLM_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "gsk-groq-test");
    const { getLLM } = await import("@/lib/llm");
    const cfg = getLLM();
    expect(cfg.provider).toBe("groq");
    expect(cfg.model).toBe("llama-3.3-70b-versatile");
  });

  it("falls back to OpenAI when LLM_PROVIDER=groq but GROQ_API_KEY is missing", async () => {
    vi.stubEnv("LLM_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-fallback");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getLLM } = await import("@/lib/llm");
    const cfg = getLLM();
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-4o");
  });

  it("is case-insensitive on the LLM_PROVIDER value", async () => {
    vi.stubEnv("LLM_PROVIDER", "GROQ");
    vi.stubEnv("GROQ_API_KEY", "gsk-xyz");
    const { getLLM } = await import("@/lib/llm");
    expect(getLLM().provider).toBe("groq");
  });

  it("ignores unknown provider values and defaults to openai", async () => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
    const { getLLM } = await import("@/lib/llm");
    expect(getLLM().provider).toBe("openai");
  });
});
