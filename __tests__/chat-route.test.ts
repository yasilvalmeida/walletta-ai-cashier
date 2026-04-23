import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared mock state — set per test.
interface StreamDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}
interface StreamChunk {
  choices: Array<{
    delta?: StreamDelta;
    finish_reason?: "stop" | "tool_calls" | null;
  }>;
}

// One stream queue per create() call — the route may call create() twice
// when tool_calls trigger the follow-up pass.
let streamQueue: StreamChunk[][] = [];
let streamError: Error | null = null;
let createCalls: Array<Record<string, unknown>> = [];

vi.mock("openai", () => {
  class OpenAI {
    constructor(public opts: Record<string, unknown>) {}
    chat = {
      completions: {
        create: vi.fn(async (args: Record<string, unknown>) => {
          createCalls.push(args);
          if (streamError) throw streamError;
          const chunks = streamQueue.shift() ?? [];
          return (async function* () {
            for (const c of chunks) yield c;
          })();
        }),
      },
    };
  }
  return { default: OpenAI };
});

// Minimal catalog so the force-add logic has something to match on.
vi.mock("@/lib/catalog", () => ({
  getAllProducts: () => [
    {
      id: "prod-americano",
      name: "Americano",
      display_name: "Americano",
      price: 4,
      search_keywords: ["americano"],
      category: "coffee",
      sizes: [],
      customizations: [],
    },
  ],
}));

beforeEach(() => {
  streamQueue = [];
  streamError = null;
  createCalls = [];
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(
  body: unknown,
  opts: { url?: string; raw?: string } = {}
): Request {
  const url = opts.url ?? "http://localhost/api/chat";
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: opts.raw ?? JSON.stringify(body),
  });
}

async function readSSE(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""));
}

const validBody = {
  messages: [{ role: "user", content: "hi" }],
  cartContext: [],
};

describe("/api/chat — warmup + validation", () => {
  it("short-circuits ?warmup=1 to 204", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      makeRequest(undefined, { url: "http://localhost/api/chat?warmup=1" })
    );
    expect(res.status).toBe(204);
    expect(createCalls).toHaveLength(0);
  });

  it("returns 400 for empty body", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest({}, { raw: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages is the wrong shape", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      makeRequest({ messages: "hi", cartContext: [] })
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/chat — streaming happy path", () => {
  it("streams text deltas and closes with a done event", async () => {
    streamQueue = [
      [
        { choices: [{ delta: { content: "Sure" } }] },
        { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
      ],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    expect(events).toEqual([
      { type: "text", delta: "Sure" },
      { type: "text", delta: "!" },
      { type: "done" },
    ]);
  });

  it("emits cart_action events for add_to_cart tool calls", async () => {
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    function: {
                      name: "add_to_cart",
                      arguments:
                        '{"product_id":"prod-americano","product_name":"Americano","quantity":1,"unit_price":4}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      // Follow-up pass: the route makes a second create() call with the
      // tool result and expects the LLM to return a text wrap-up.
      [
        {
          choices: [
            { delta: { content: "Added!" }, finish_reason: "stop" },
          ],
        },
      ],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "cart_action",
        action: "add_to_cart",
        payload: expect.objectContaining({
          product_id: "prod-americano",
          quantity: 1,
        }),
      })
    );
    expect(events).toContainEqual({ type: "text", delta: "Added!" });
    expect(events.at(-1)).toEqual({ type: "done" });
    // Two create() calls — initial + follow-up after the tool.
    expect(createCalls).toHaveLength(2);
  });

  it("emits cart_action events for remove_from_cart tool calls", async () => {
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    function: {
                      name: "remove_from_cart",
                      arguments: '{"product_id":"prod-americano"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      [{ choices: [{ delta: { content: "Removed." }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "cart_action",
        action: "remove_from_cart",
        payload: { product_id: "prod-americano" },
      })
    );
  });

  it("forces tool_choice=add_to_cart when the user mentions a catalog item", async () => {
    streamQueue = [
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "one americano" }],
        cartContext: [],
      })
    );
    expect(createCalls[0].tool_choice).toMatchObject({
      type: "function",
      function: { name: "add_to_cart" },
    });
  });

  it("injects the language-mirror instruction when language is non-English (line 179)", async () => {
    streamQueue = [
      [{ choices: [{ delta: { content: "¡Hola!" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hola" }],
        cartContext: [],
        language: "es",
      })
    );
    const systemMsg = (createCalls[0].messages as Array<{
      role: string;
      content: string;
    }>)[0];
    // System prompt should mention Spanish explicitly when language=es.
    expect(systemMsg.content).toMatch(/Spanish/i);
  });

  it("handles request bodies with no prior user message (line 257 ?? '' fallback)", async () => {
    streamQueue = [
      [{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      makeRequest({
        // No user turns at all — lastUser is undefined.
        messages: [{ role: "assistant", content: "hello" }],
        cartContext: [],
      })
    );
    expect(res.status).toBe(200);
  });

  it("tolerates streaming chunks with no choices (line 316 'if (!choice) continue')", async () => {
    streamQueue = [
      [
        { choices: [] }, // empty choices → choice === undefined → continue
        { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] },
      ],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    expect(events).toContainEqual({ type: "text", delta: "ok" });
  });

  it("initialises tool_call accumulator entries even when name is missing (line 335 || '')", async () => {
    // First chunk: tool_call with only `id` — no name. Second: adds name.
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: "tc1" }],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: "add_to_cart",
                      arguments:
                        '{"product_id":"prod-americano","product_name":"Americano","quantity":1,"unit_price":4}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      [{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "cart_action",
        action: "add_to_cart",
      })
    );
  });

  it("forwards add_to_cart payload with missing quantity via `|| 1` fallback (line 384)", async () => {
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    function: {
                      name: "add_to_cart",
                      // Intentionally omit quantity — `payload.quantity || 1` fallback fires.
                      arguments:
                        '{"product_id":"prod-americano","product_name":"Americano","unit_price":4}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    const cart = events.find((e) => e.type === "cart_action");
    expect(cart.payload.quantity).toBe(1);
  });

  it("handles streaming tool_call chunks that arrive with no `arguments` field (line 345)", async () => {
    // First chunk delivers name, second chunk delivers id+arguments —
    // covers the branch where tc.function?.arguments is undefined on
    // the initial chunk.
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { name: "add_to_cart" } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    function: {
                      arguments:
                        '{"product_id":"prod-americano","product_name":"Americano","quantity":1,"unit_price":4}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      [{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "cart_action",
        action: "add_to_cart",
      })
    );
  });

  it("handles follow-up stream chunks with no content (line 441 delta?.content false arm)", async () => {
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    function: {
                      name: "add_to_cart",
                      arguments:
                        '{"product_id":"prod-americano","product_name":"Americano","quantity":1,"unit_price":4}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      // Follow-up stream with choices but NO delta.content — exercises
      // the empty-content branch of line 441.
      [
        { choices: [{ delta: {} }] },
        { choices: [{}] }, // no delta at all
        { choices: [{ delta: { content: "" } }] }, // empty content
        { choices: [{ delta: { content: "done" }, finish_reason: "stop" }] },
      ],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    // Only the last content chunk emits a text event; the three
    // content-less chunks are skipped by the branch.
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].delta).toBe("done");
  });

  it("does NOT force add_to_cart on pure finalize turns", async () => {
    streamQueue = [
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "that's all" }],
        cartContext: [],
      })
    );
    expect(createCalls[0].tool_choice).toBe("auto");
  });

  it("renders plain cart items without size or modifiers (line 165/167 false arms)", async () => {
    streamQueue = [
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "anything else?" }],
        cartContext: [
          {
            product_id: "p1",
            product_name: "Plain Item",
            quantity: 1,
            unit_price: 4,
            line_total: 4,
            // no size, no modifiers
          },
        ],
      })
    );
    const systemMsg = (createCalls[0].messages as Array<{
      role: string;
      content: string;
    }>)[0];
    expect(systemMsg.content).toContain("Plain Item");
    // No size/modifiers brackets — both if-guards took their false arms.
    expect(systemMsg.content).not.toMatch(/\[size:/);
    expect(systemMsg.content).not.toMatch(/\[modifiers:/);
  });

  it("renders cartContext summary (items + size + modifiers) into the system prompt", async () => {
    streamQueue = [
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "anything else?" }],
        cartContext: [
          {
            product_id: "prod-americano",
            product_name: "Americano",
            quantity: 2,
            unit_price: 4,
            size: "16oz",
            modifiers: [{ label: "Oat Milk", price: 0.75 }],
            line_total: 9.5,
          },
        ],
      })
    );
    const systemMsg = (createCalls[0].messages as Array<{
      role: string;
      content: string;
    }>)[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("Americano x2");
    expect(systemMsg.content).toContain("size: 16oz");
    expect(systemMsg.content).toContain("Oat Milk");
    expect(systemMsg.content).toContain("Subtotal");
  });

  it("forwards cart_action modifiers through the filter and into the SSE event", async () => {
    // Exercises the Modifier[] runtime filter at lines 365-376. Includes
    // a bad entry to ensure the filter strips non-conforming items.
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    function: {
                      name: "add_to_cart",
                      arguments: JSON.stringify({
                        product_id: "prod-americano",
                        product_name: "Americano",
                        quantity: 1,
                        unit_price: 4,
                        size: "16oz",
                        modifiers: [
                          { label: "Oat Milk", price: 0.75 },
                          "not an object",
                          { label: "bad", price: "zero" },
                        ],
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      [{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    const cartEvent = events.find((e) => e.type === "cart_action");
    expect(cartEvent.payload.modifiers).toEqual([
      { label: "Oat Milk", price: 0.75 },
    ]);
    expect(cartEvent.payload.size).toBe("16oz");
  });

  it("does NOT force add_to_cart on remove/correction turns", async () => {
    streamQueue = [
      [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }],
    ];
    const { POST } = await import("@/app/api/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "remove the americano" }],
        cartContext: [],
      })
    );
    expect(createCalls[0].tool_choice).toBe("auto");
  });
});

describe("/api/chat — error handling", () => {
  it("skips malformed tool_call arguments without tearing down the stream", async () => {
    streamQueue = [
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc1",
                    function: {
                      name: "add_to_cart",
                      arguments: "not-json",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      [
        { choices: [{ delta: { content: "recovered" }, finish_reason: "stop" }] },
      ],
    ];
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    // No cart_action emitted for the bad payload, but the stream still
    // finishes cleanly.
    expect(events.some((e) => e.type === "cart_action")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("returns 500 when the LLM call itself rejects (pre-stream)", async () => {
    streamError = new Error("auth failed");
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("auth failed");
  });

  it("uses 'Stream error' fallback when mid-flow throw is a non-Error value (line 453)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/catalog", () => ({
      getAllProducts: () => [
        {
          id: "p1",
          name: "A",
          display_name: "A",
          price: 1,
          search_keywords: [],
          sizes: [],
          customizations: [],
        },
      ],
    }));
    vi.doMock("openai", () => ({
      default: class {
        chat = {
          completions: {
            create: async () => ({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: "partial" } }] };
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw "mid-stream-primitive";
              },
            }),
          },
        };
      },
    }));
    const { POST: FreshPOST } = await import("@/app/api/chat/route");
    const res = await FreshPOST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          cartContext: [],
        }),
      })
    );
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("Stream error");
  });

  it("emits a type=error SSE event when the stream iterator throws mid-flow", async () => {
    // Simulate a mid-stream crash: first chunk delivers, then the
    // iterator yields an error on the next tick. The route's inner
    // try/catch wraps the for-await loop, so this must land in the
    // SSE error-event branch (not the outer 500).
    const brokenStream: Array<StreamChunk | Error> = [
      { choices: [{ delta: { content: "partial" } }] },
      new Error("stream blew up"),
    ];
    // Replace the streamQueue with an async iterable that throws.
    streamQueue = [];
    const origPush = createCalls.push.bind(createCalls);
    createCalls.push = (args: Record<string, unknown>) => {
      origPush(args);
      return createCalls.length;
    };
    // Re-assign the mock so create() returns our iterator.
    vi.resetModules();
    vi.doMock("openai", () => {
      class OpenAI {
        constructor() {}
        chat = {
          completions: {
            create: async () => ({
              [Symbol.asyncIterator]: async function* () {
                for (const item of brokenStream) {
                  if (item instanceof Error) throw item;
                  yield item;
                }
              },
            }),
          },
        };
      }
      return { default: OpenAI };
    });
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeRequest(validBody));
    const events = (await readSSE(res)).map((e) => JSON.parse(e));
    expect(events).toContainEqual({ type: "text", delta: "partial" });
    expect(events).toContainEqual({
      type: "error",
      message: "stream blew up",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
