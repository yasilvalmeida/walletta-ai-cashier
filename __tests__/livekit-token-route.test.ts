import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock AccessToken BEFORE importing the route. Must be a real class —
// vi.fn() with an arrow implementation can't be used with `new`.
vi.mock("livekit-server-sdk", () => {
  class AccessToken {
    constructor() {}
    addGrant() {}
    async toJwt() {
      return "jwt-test-token";
    }
  }
  return { AccessToken };
});

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/livekit/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/livekit/token", () => {
  it("returns 400 if roomName or participantName are missing", async () => {
    vi.stubEnv("LIVEKIT_API_KEY", "k");
    vi.stubEnv("LIVEKIT_API_SECRET", "s");
    vi.stubEnv("LIVEKIT_URL", "wss://lk.example");
    const { POST } = await import("@/app/api/livekit/token/route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 503 when LiveKit credentials are not configured", async () => {
    vi.stubEnv("LIVEKIT_API_KEY", "");
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    vi.stubEnv("LIVEKIT_URL", "");
    const { POST } = await import("@/app/api/livekit/token/route");
    const res = await POST(
      makeRequest({ roomName: "r", participantName: "p" })
    );
    expect(res.status).toBe(503);
  });

  it("returns { token, url } on success", async () => {
    vi.stubEnv("LIVEKIT_API_KEY", "k");
    vi.stubEnv("LIVEKIT_API_SECRET", "s");
    vi.stubEnv("LIVEKIT_URL", "wss://lk.example");
    const { POST } = await import("@/app/api/livekit/token/route");
    const res = await POST(
      makeRequest({ roomName: "room", participantName: "alice" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      token: "jwt-test-token",
      url: "wss://lk.example",
    });
  });

  it("returns 500 if the request body fails to parse", async () => {
    vi.stubEnv("LIVEKIT_API_KEY", "k");
    vi.stubEnv("LIVEKIT_API_SECRET", "s");
    vi.stubEnv("LIVEKIT_URL", "wss://lk.example");
    const { POST } = await import("@/app/api/livekit/token/route");
    const res = await POST(
      new Request("http://localhost/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(500);
  });
});
