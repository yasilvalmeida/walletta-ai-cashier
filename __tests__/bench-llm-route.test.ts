import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type StreamChunk = {
  choices: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

// Per-test we replace this factory so vi.mock can return a fresh client
// shape. Declared at module scope so the hoisted vi.mock below can see
// it.
let mockStreamChunks: StreamChunk[] = [];
let mockShouldThrow: Error | null = null;

vi.mock("openai", () => {
  class OpenAI {
    constructor(public opts: Record<string, unknown>) {}
    chat = {
      completions: {
        create: vi.fn(async () => {
          if (mockShouldThrow) throw mockShouldThrow;
          return (async function* () {
            for (const c of mockStreamChunks) yield c;
          })();
        }),
      },
    };
  }
  return { default: OpenAI };
});

import { clearRuns } from "@/lib/benchLog";

beforeEach(() => {
  clearRuns();
  mockStreamChunks = [];
  mockShouldThrow = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(body: unknown, raw?: string): Request {
  return new Request("http://localhost/api/bench/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("/api/bench/llm — GET (list runs)", () => {
  it("returns an empty list when no benchmarks have run", async () => {
    const { GET } = await import("@/app/api/bench/llm/route");
    const res = await GET();
    const data = await res.json();
    expect(data.runs).toEqual([]);
  });
});

describe("/api/bench/llm — POST (run benchmark)", () => {
  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(makeRequest({}, "not json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the prompt is missing", async () => {
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("records an error result when an API key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(makeRequest({ prompt: "hi" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const providers = data.run.providers as Array<{
      ok: boolean;
      error?: string;
    }>;
    expect(providers.every((p) => !p.ok)).toBe(true);
    expect(providers.some((p) => /API_KEY/i.test(p.error ?? ""))).toBe(true);
  });

  it("streams content + tool_calls and reports ttft / totalMs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("GROQ_API_KEY", "");
    mockStreamChunks = [
      { choices: [{ delta: { content: "Got " } }] },
      { choices: [{ delta: { content: "it." } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { name: "add_to_cart", arguments: '{"x":1}' },
                },
              ],
            },
          },
        ],
      },
    ];
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(
      makeRequest({ prompt: "one latte please", providers: ["openai"] })
    );
    const data = await res.json();
    const openaiResult = data.run.providers.find(
      (p: { provider: string }) => p.provider === "openai"
    );
    expect(openaiResult.ok).toBe(true);
    expect(openaiResult.responseText).toBe("Got it.");
    expect(openaiResult.outputTokens).toBe(2);
    expect(openaiResult.toolCalls).toEqual([
      { name: "add_to_cart", args: '{"x":1}' },
    ]);
    expect(typeof openaiResult.ttftMs).toBe("number");
    expect(typeof openaiResult.totalMs).toBe("number");
  });

  it("records an ok:false result when the stream throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("GROQ_API_KEY", "");
    mockShouldThrow = new Error("rate limited");
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(
      makeRequest({ prompt: "hi", providers: ["openai"] })
    );
    const data = await res.json();
    const openaiResult = data.run.providers.find(
      (p: { provider: string }) => p.provider === "openai"
    );
    expect(openaiResult.ok).toBe(false);
    expect(openaiResult.error).toBe("rate limited");
  });

  it("tolerates streaming chunks with no delta and no tool-call metadata", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("GROQ_API_KEY", "");
    mockStreamChunks = [
      { choices: [{}] }, // no delta at all — skipped via `continue`
      { choices: [{ delta: {} }] }, // empty delta
      {
        choices: [
          {
            delta: {
              // tool_call with no index and no function info — exercises
              // defaults for `idx = tc.index ?? 0` and the missing-
              // function guards.
              tool_calls: [{}],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              // Split tool_call: name arrives first, then arguments in a
              // second chunk — exercises the accumulator keeping the
              // existing entry and appending arguments.
              tool_calls: [{ index: 0, function: { name: "only_name" } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "{}" } }],
            },
          },
        ],
      },
    ];
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(
      makeRequest({ prompt: "hi", providers: ["openai"] })
    );
    const data = await res.json();
    const openaiResult = data.run.providers.find(
      (p: { provider: string }) => p.provider === "openai"
    );
    expect(openaiResult.ok).toBe(true);
    // Accumulator produced one tool call with the split name + args merged.
    expect(openaiResult.toolCalls).toEqual([
      { name: "only_name", args: "{}" },
    ]);
  });

  it("reports ttftMs=undefined when the stream has no chunks (line 136 false arm)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("GROQ_API_KEY", "");
    mockStreamChunks = []; // Empty stream — for-await-of never enters the body.
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(
      makeRequest({ prompt: "hi", providers: ["openai"] })
    );
    const data = await res.json();
    const openai = data.run.providers.find(
      (p: { provider: string }) => p.provider === "openai"
    );
    expect(openai.ok).toBe(true);
    // ttftMs was never set because the loop body never ran — line 136's
    // undefined-arm of the ternary fires.
    expect(openai.ttftMs).toBeUndefined();
  });

  it("filters providers when the request specifies only one", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    mockStreamChunks = [{ choices: [{ delta: { content: "ok" } }] }];
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(
      makeRequest({ prompt: "hi", providers: ["openai"] })
    );
    const data = await res.json();
    expect(data.run.providers).toHaveLength(1);
    expect(data.run.providers[0].provider).toBe("openai");
  });
});
