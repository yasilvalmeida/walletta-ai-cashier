import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/tavus/cleanup", () => {
  it("returns 503 when TAVUS_API_KEY is unset", async () => {
    vi.stubEnv("TAVUS_API_KEY", "");
    const { POST } = await import("@/app/api/tavus/cleanup/route");
    const res = await POST();
    expect(res.status).toBe(503);
  });

  it("delegates to endAllActiveConversations and returns the summary", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url.includes("?limit=100")) {
          return new Response(
            JSON.stringify({
              data: [
                { conversation_id: "a", status: "active" },
                { conversation_id: "b", status: "ended" },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      })
    );
    const { POST } = await import("@/app/api/tavus/cleanup/route");
    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scanned).toBe(2);
    expect(data.ended).toBe(1);
  });
});
