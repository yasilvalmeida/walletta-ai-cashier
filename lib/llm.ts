import OpenAI from "openai";

// LLM provider abstraction. Both OpenAI and Groq speak the OpenAI
// Chat Completions API surface, so the same SDK + same request shape
// works for either provider — only the `baseURL` and `apiKey` differ.
//
// Select via the `LLM_PROVIDER` env var:
//   "openai" (default)  → GPT-4o, ~400-600ms to first token
//   "groq"              → Llama 3.3 70B on Groq LPU, ~150-180ms to first token
//
// Groq's Llama 3.3 70B supports OpenAI-compatible tool calling, which
// our cart pipeline requires (add_to_cart / remove_from_cart tool
// calls fire during streaming). Function-calling reliability on Groq
// is slightly less deterministic than GPT-4o for fuzzy matches, but
// the 300-400ms latency win is material for the "avatar-takes-1s-
// to-reply" complaint from Temur.

export type LLMProvider = "openai" | "groq";

const MODEL_BY_PROVIDER: Record<LLMProvider, string> = {
  openai: "gpt-4o",
  groq: "llama-3.3-70b-versatile",
};

const BASE_URL_BY_PROVIDER: Record<LLMProvider, string | undefined> = {
  openai: undefined, // default OpenAI endpoint
  groq: "https://api.groq.com/openai/v1",
};

function resolveProvider(): LLMProvider {
  const raw = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
  if (raw === "groq") return "groq";
  return "openai";
}

export interface LLMConfig {
  client: OpenAI;
  model: string;
  provider: LLMProvider;
}

// Returns an OpenAI SDK client pointed at the selected provider.
// Fallback: if LLM_PROVIDER=groq but GROQ_API_KEY is missing we silently
// fall back to OpenAI rather than crash the /api/chat route — same
// behavior the client has always seen.
export function getLLM(): LLMConfig {
  const provider = resolveProvider();
  if (provider === "groq") {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      console.warn(
        "[LLM] LLM_PROVIDER=groq but GROQ_API_KEY is unset — falling back to OpenAI"
      );
      return {
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        model: MODEL_BY_PROVIDER.openai,
        provider: "openai",
      };
    }
    return {
      client: new OpenAI({
        apiKey: groqKey,
        baseURL: BASE_URL_BY_PROVIDER.groq,
      }),
      model: MODEL_BY_PROVIDER.groq,
      provider: "groq",
    };
  }
  return {
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    model: MODEL_BY_PROVIDER.openai,
    provider: "openai",
  };
}
