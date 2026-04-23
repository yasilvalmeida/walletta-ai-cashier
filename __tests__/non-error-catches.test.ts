// Pushes every route's outer catch block through the non-Error fallback
// arm: `err instanceof Error ? err.message : "…"`. Most real SDKs only
// throw Error subclasses, so the fallback arm is dead code in practice —
// but v8 branch coverage wants both arms of the ternary hit.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Non-Error catch fallback arms", () => {
  it("/api/deepgram/token returns 500 with fallback string when a non-Error is thrown", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-k");
    const nextServer = await import("next/server");
    // Capture the REAL implementation before spying so the catch branch's
    // NextResponse.json can still build a real response.
    const realJson = nextServer.NextResponse.json.bind(nextServer.NextResponse);
    let first = true;
    vi.spyOn(nextServer.NextResponse, "json").mockImplementation(
      ((...args: unknown[]) => {
        if (first) {
          first = false;
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "not-an-error";
        }
        return (realJson as (...a: unknown[]) => Response)(...args);
      }) as unknown as typeof nextServer.NextResponse.json
    );
    const { POST } = await import("@/app/api/deepgram/token/route");
    const res = await POST();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to generate Deepgram token");
  });

  it("/api/tts returns 500 with fallback when fetch throws a non-Error", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "net-string";
      })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tts/route");
    const res = await POST(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("TTS request failed");
  });

  it("/api/livekit/token returns 500 with fallback when AccessToken throws a non-Error", async () => {
    vi.doMock("livekit-server-sdk", () => {
      class AccessToken {
        constructor() {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "ctor-plain-string";
        }
      }
      return { AccessToken };
    });
    vi.stubEnv("LIVEKIT_API_KEY", "k");
    vi.stubEnv("LIVEKIT_API_SECRET", "s");
    vi.stubEnv("LIVEKIT_URL", "wss://lk.example");
    const { POST } = await import("@/app/api/livekit/token/route");
    const res = await POST(
      new Request("http://localhost/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: "r", participantName: "p" }),
      })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to generate LiveKit token");
  });

  it("/api/tavus/session returns 500 with fallback when fetch throws a non-Error", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "socket-string";
      })
    );
    const { POST } = await import("@/app/api/tavus/session/route");
    const res = await POST(
      new Request("http://localhost/api/tavus/session", { method: "POST" })
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to create Tavus session");
  });

  it("/api/chat returns 500 with generic fallback when LLM create() throws a non-Error", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-t");
    vi.doMock("openai", () => ({
      default: class {
        chat = {
          completions: {
            create: async () => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error
              throw "sdk-plain-string";
            },
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
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Internal server error");
  });
});
