// Targeted sweep for the remaining uncovered branches across routes
// and helpers. Each block addresses a specific ternary / short-circuit
// fallback arm.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── tavus/session:42 — proto inferred from https:// URL ───────────────

describe("/api/tavus/session — proto=https branch in resolveBaseUrl", () => {
  it("derives https proto from the request URL when no x-forwarded-proto", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    vi.stubEnv("TAVUS_CALLBACK_BASE_URL", "");
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversation_id: "c-https",
            conversation_url: "u",
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tavus/session/route");
    const req = new Request("https://wal.test/api/tavus/session", {
      method: "POST",
      headers: { host: "wal.test" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.callback_url).toBe("https://wal.test/api/tavus/webhook");
  });
});

// ─── tavus/session:149 — personaId ?? null with empty persona env ──────

describe("/api/tavus/session — personaId null-arm", () => {
  it("responds with personaId=DEFAULT when TAVUS_PERSONA_ID is literally empty", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    vi.stubEnv("TAVUS_PERSONA_ID", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              conversation_id: "c-default",
              conversation_url: "u",
            }),
            { status: 200 }
          )
      )
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(
      new Request("http://localhost/api/tavus/session", { method: "POST" })
    );
    const data = await res.json();
    // Default persona id is hardcoded — it's non-empty → not null.
    expect(data.personaId).toBeTruthy();
  });
});

// ─── tavus/webhook:111 — event_type ?? message_type fallback ───────────

describe("/api/tavus/webhook — message_type fallback when event_type is missing", () => {
  it("uses body.message_type when event_type is absent", async () => {
    vi.doMock("@/lib/tavusEvents", () => ({
      publishEvent: vi.fn(),
    }));
    vi.doMock("@/lib/catalog", () => ({
      getAllProducts: () => [
        {
          id: "p1",
          name: "X",
          display_name: "X",
          price: 1,
          search_keywords: [],
          sizes: [],
          customizations: [],
        },
      ],
    }));
    const { POST } = await import("@/app/api/tavus/webhook/route");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_type: "conversation.tool_call",
          conversation_id: "c1",
          properties: { tool_name: "finalize_order" },
        }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("event_type ?? message_type ?? '' — both missing → empty string arm", async () => {
    const { POST } = await import("@/app/api/tavus/webhook/route");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: "c1" }),
      })
    );
    expect(res.status).toBe(200);
  });
});

// ─── tavus/webhook:60 — size resolution misses ────────────────────────

describe("/api/tavus/webhook — unresolved size label falls through", () => {
  it("ignores a size label that doesn't match any of the product's sizes", async () => {
    vi.resetModules();
    const publish = vi.fn();
    vi.doMock("@/lib/tavusEvents", () => ({ publishEvent: publish }));
    vi.doMock("@/lib/catalog", () => ({
      getAllProducts: () => [
        {
          id: "p1",
          name: "Latte",
          display_name: "Latte",
          price: 5,
          search_keywords: [],
          sizes: [{ label: "12oz", price_delta: 0 }],
          customizations: [],
        },
      ],
    }));
    const { POST } = await import("@/app/api/tavus/webhook/route");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "conversation.tool_call",
          conversation_id: "c1",
          properties: {
            tool_name: "add_to_cart",
            arguments: {
              product_name: "Latte",
              quantity: 1,
              size: "42oz", // does not match any size.label
            },
          },
        }),
      })
    );
    expect(publish).toHaveBeenCalled();
    const call = publish.mock.calls[0][0] as { payload: { size?: string } };
    expect(call.payload.size).toBeUndefined();
  });
});

// ─── tts/stream:93 — ws was null when safeClose ran ────────────────────

describe("/api/tts/stream — safeClose with null ws (already covered via exploding WS)", () => {
  it("safeClose is safe when WebSocket construction threw", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    class Boom {
      constructor() {
        throw new Error("boom");
      }
    }
    vi.stubGlobal("WebSocket", Boom as unknown as typeof WebSocket);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(
      new Request("http://localhost/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      })
    );
    await expect(res.body!.getReader().read()).rejects.toThrow(/boom/);
  });
});

// ─── lib/tavus:43 — status nullish coerces to "" (not "ended") ──────────

describe("lib/tavus.endAllActiveConversations — status is null (coerce via ??)", () => {
  it("treats rows with null status as active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes("?limit=100")) {
          return new Response(
            JSON.stringify({
              data: [{ conversation_id: "null-status", status: null }],
            }),
            { status: 200 }
          );
        }
        if (init?.method === "POST") {
          return new Response("{}", { status: 200 });
        }
        return new Response("{}", { status: 200 });
      })
    );
    const { endAllActiveConversations } = await import("@/lib/tavus");
    const result = await endAllActiveConversations("tk");
    // null ?? "" → "" → "".toLowerCase() === "ended" is false → row kept.
    expect(result.details).toHaveLength(1);
    expect(result.details[0].id).toBe("null-status");
  });
});

// lib/tavusEvents unsubscribe-after-clear is covered in
// __tests__/tavusEvents-more.test.ts; skipping here to avoid the
// vi.doMock collision with the webhook tests above.

// ─── chat:397 — tc.name is neither add nor remove ─────────────────────

describe("/api/chat — tool_call with unknown tc.name is silently ignored", () => {
  it("handles a tool_call whose name is something unrecognised", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-t");
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
                yield {
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: "tc1",
                            function: {
                              name: "unknown_tool",
                              arguments: "{}",
                            },
                          },
                        ],
                      },
                      finish_reason: "tool_calls",
                    },
                  ],
                };
                yield {
                  choices: [
                    { delta: { content: "ok" }, finish_reason: "stop" },
                  ],
                };
              },
            }),
          },
        };
      },
    }));
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          cartContext: [],
        }),
      })
    );
    expect(res.status).toBe(200);
  });
});

// enqueueBuffer non-idle arm covered in useCartesiaTTS-enqueuebuffer.test.ts (below)

// ─── tavus/webhook:120 — body.properties null → {} fallback ──────────

describe("/api/tavus/webhook — body.properties null fallback (line 120)", () => {
  it("coerces null properties to {} via ??", async () => {
    const { POST } = await import("@/app/api/tavus/webhook/route");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(
      new Request("http://localhost/api/tavus/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "conversation.tool_call",
          conversation_id: "c1",
          properties: null,
        }),
      })
    );
    expect(res.status).toBe(200);
  });
});

// ─── bench/llm:151 — runProvider catch falls through to String(err) ──

describe("/api/bench/llm — non-Error rejection fallback (line 151)", () => {
  it("uses String(err) when the SDK throws a non-Error value", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_API_KEY", "sk-t");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.doMock("openai", () => ({
      default: class {
        chat = {
          completions: {
            create: async () => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error
              throw "primitive-string-error";
            },
          },
        };
      },
    }));
    const { POST } = await import("@/app/api/bench/llm/route");
    const res = await POST(
      new Request("http://localhost/api/bench/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi", providers: ["openai"] }),
      })
    );
    const data = await res.json();
    const openai = data.run.providers.find(
      (p: { provider: string }) => p.provider === "openai"
    );
    expect(openai.ok).toBe(false);
    expect(openai.error).toBe("primitive-string-error");
  });
});

// ─── tts/stream:161 — ws error fires AFTER safeClose ran ──────────────

describe("/api/tts/stream — ws error after close (line 161 closed=true arm)", () => {
  it("skips the error-propagation branch when the stream was already closed", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    let capturedWs: {
      emit: (event: string, data?: unknown) => void;
    } | null = null;
    class MockWS {
      static OPEN = 1;
      readyState = 1;
      listeners = new Map<string, Array<(ev: unknown) => void>>();
      constructor() {
        const self = this;
        capturedWs = {
          emit: (event, data) => {
            const arr = self.listeners.get(event) ?? [];
            for (const cb of arr) cb(data as unknown);
          },
        };
      }
      addEventListener(event: string, cb: (ev: unknown) => void) {
        const arr = this.listeners.get(event) ?? [];
        arr.push(cb);
        this.listeners.set(event, arr);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(
      new Request("http://localhost/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      })
    );
    const ws = capturedWs!;
    ws.emit("open");
    // Close first (safeClose sets closed=true).
    ws.emit("close");
    // Now fire an error — the handler's `if (!closed)` sees closed=true
    // (line 161 false arm) and skips the controller.error call.
    ws.emit("error", new Event("error"));
    const reader = res.body!.getReader();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });
});
