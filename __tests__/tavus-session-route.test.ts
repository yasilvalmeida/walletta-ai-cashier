import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(): Request {
  return new Request("http://localhost/api/tavus/session", { method: "POST" });
}

describe("/api/tavus/session — success + error shapes", () => {
  it("returns 503 when TAVUS_API_KEY is unset", async () => {
    vi.stubEnv("TAVUS_API_KEY", "");
    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });

  it("creates a conversation and returns ids + url on 200", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    vi.stubEnv("TAVUS_CALLBACK_BASE_URL", "https://example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              conversation_id: "c-new",
              conversation_url: "https://tavus.daily.co/c-new",
            }),
            { status: 200 }
          )
      )
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      conversationId: "c-new",
      conversationUrl: "https://tavus.daily.co/c-new",
      replicaId: expect.any(String),
      personaId: expect.any(String),
    });
  });

  it("propagates Tavus 402 (out of credits) without retrying", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ message: "The user is out of conversational credits." }),
          { status: 402 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(402);
    // Must NOT fire cleanup — only one POST to Tavus (the create call).
    const createCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/v2/conversations")
    );
    expect(createCalls.length).toBe(1);
  });

  it("recovers from the max-concurrent 400 by calling cleanup and retrying once", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    let createCount = 0;
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      // Tavus list endpoint used by endAllActiveConversations.
      if (url.includes("/v2/conversations?limit=100")) {
        return new Response(
          JSON.stringify({
            data: [{ conversation_id: "stale", status: "active" }],
          }),
          { status: 200 }
        );
      }
      // "/conversations/<id>/end"
      if (url.includes("/end") && init?.method === "POST") {
        return new Response("{}", { status: 200 });
      }
      // The create POST — first call 400s with the magic string, second
      // succeeds.
      if (url.endsWith("/v2/conversations")) {
        createCount += 1;
        if (createCount === 1) {
          return new Response(
            JSON.stringify({
              message: "User has reached maximum concurrent conversations",
            }),
            { status: 400 }
          );
        }
        return new Response(
          JSON.stringify({
            conversation_id: "c-retry",
            conversation_url: "https://tavus.daily.co/c-retry",
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Short-circuit the 1500 ms retry delay so the test runs fast.
    vi.spyOn(global, "setTimeout").mockImplementation(
      ((cb: () => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout
    );

    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversationId).toBe("c-retry");
    expect(createCount).toBe(2);
  });

  it("propagates a second failure after cleanup+retry (line 127 false arm)", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    let createCount = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes("/v2/conversations?limit=100")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.endsWith("/v2/conversations")) {
        createCount += 1;
        // Fail twice in a row with the max-concurrent error. The retry
        // block's failureText reassignment hits the `response.text()`
        // arm of the ternary (line 127 false arm).
        return new Response(
          JSON.stringify({
            message: "User has reached maximum concurrent conversations",
          }),
          { status: 400 }
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "setTimeout").mockImplementation(
      ((cb: () => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout
    );

    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(createCount).toBe(2);
  });

  it("surfaces a clean 500 when the fetch itself throws", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/network down/);
  });
});
