import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  listRuns,
  pushRun,
  type BenchProviderResult,
} from "@/lib/benchLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal add_to_cart tool, identical shape to /api/chat/route.ts so
// the benchmark reflects real-world tool-calling performance. We don't
// need the full tool schema — this is a latency probe.
const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description:
        "Add an item to the customer's cart. Call IMMEDIATELY when the customer names a menu item.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
        },
        required: ["product_name", "quantity", "unit_price"],
      },
    },
  },
];

const SYSTEM = `You are Jordan, an AI cashier at Erewhon Market. Keep replies under 2 sentences. When a customer names any drink (latte, americano, cappuccino, matcha, cold brew), immediately call add_to_cart with a plausible price ($4-8) before speaking.`;

interface ProviderConfig {
  provider: "openai" | "groq";
  model: string;
  apiKey: string | undefined;
  baseURL?: string;
}

function providerConfigs(): ProviderConfig[] {
  return [
    {
      provider: "openai",
      model: "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    },
    {
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    },
  ];
}

async function runProvider(
  cfg: ProviderConfig,
  prompt: string
): Promise<BenchProviderResult> {
  if (!cfg.apiKey) {
    return {
      provider: cfg.provider,
      model: cfg.model,
      ok: false,
      error: `${cfg.provider.toUpperCase()}_API_KEY not set`,
    };
  }

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];

  const t0 = performance.now();
  let ttftMs: number | undefined;
  let fullText = "";
  const toolCalls: Record<
    number,
    { name: string; arguments: string }
  > = {};
  let tokenCount = 0;

  try {
    const stream = await client.chat.completions.create({
      model: cfg.model,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      stream: true,
    });

    for await (const chunk of stream) {
      if (ttftMs === undefined) {
        ttftMs = performance.now() - t0;
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        fullText += delta.content;
        tokenCount += 1; // rough — one chunk ≈ one token
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) toolCalls[idx] = { name: "", arguments: "" };
          if (tc.function?.name) toolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) {
            toolCalls[idx].arguments += tc.function.arguments;
          }
        }
      }
    }

    const totalMs = performance.now() - t0;
    const tokensPerSec =
      tokenCount > 0 && totalMs > 0
        ? Math.round((tokenCount * 1000) / totalMs)
        : undefined;

    return {
      provider: cfg.provider,
      model: cfg.model,
      ok: true,
      ttftMs: ttftMs !== undefined ? Math.round(ttftMs) : undefined,
      totalMs: Math.round(totalMs),
      outputTokens: tokenCount,
      tokensPerSec,
      responseText: fullText,
      toolCalls: Object.values(toolCalls).map((t) => ({
        name: t.name,
        args: t.arguments,
      })),
    };
  } catch (err) {
    return {
      provider: cfg.provider,
      model: cfg.model,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  return Response.json({ runs: listRuns() });
}

export async function POST(request: Request) {
  let body: { prompt?: string; providers?: ("openai" | "groq")[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }

  const requested = new Set(body.providers ?? ["openai", "groq"]);
  const configs = providerConfigs().filter((c) => requested.has(c.provider));

  // Run in parallel so the totals aren't inflated by sequential waits.
  const results = await Promise.all(
    configs.map((cfg) => runProvider(cfg, prompt))
  );

  const run = pushRun({
    timestamp: Date.now(),
    prompt,
    providers: results,
  });

  return Response.json({ run });
}
