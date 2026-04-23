import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(body: unknown, raw?: string): Request {
  return new Request("http://localhost/api/tavus/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("/api/tavus/end", () => {
  it("returns 503 when TAVUS_API_KEY is unset", async () => {
    vi.stubEnv("TAVUS_API_KEY", "");
    const { POST } = await import("@/app/api/tavus/end/route");
    const res = await POST(makeRequest({ conversationId: "c1" }));
    expect(res.status).toBe(503);
  });

  it("returns 400 when conversationId is missing", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    const { POST } = await import("@/app/api/tavus/end/route");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("treats malformed JSON as missing conversationId → 400", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    const { POST } = await import("@/app/api/tavus/end/route");
    const res = await POST(makeRequest({}, "not json"));
    expect(res.status).toBe(400);
  });

  it("calls the Tavus end endpoint and returns ok:true on success", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/tavus/end/route");
    const res = await POST(makeRequest({ conversationId: "c1" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v2/conversations/c1/end");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("tk");
  });

  it("propagates Tavus error status and text on failure", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("already ended", { status: 409 }))
    );
    const { POST } = await import("@/app/api/tavus/end/route");
    const res = await POST(makeRequest({ conversationId: "c1" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("409");
    expect(data.error).toContain("already ended");
  });
});
