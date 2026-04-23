// Covers the resolveBaseUrl "no host header" branch (line 47 in
// app/api/tavus/session/route.ts) — the request carries neither
// x-forwarded-host nor host headers, so callback_url is undefined and
// Tavus is called without one.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/tavus/session — resolveBaseUrl fallback", () => {
  it("omits callback_url when no host header is resolvable", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    // Explicitly do NOT set TAVUS_CALLBACK_BASE_URL so the function
    // falls through to header sniffing.
    vi.stubEnv("TAVUS_CALLBACK_BASE_URL", "");

    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversation_id: "c-nohost",
            conversation_url: "u",
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { POST } = await import("@/app/api/tavus/session/route");
    // Construct a request whose URL has no host — use a bare path with
    // a synthetic base that Request will keep as-is.
    const req = new Request("http://x/api/tavus/session", {
      method: "POST",
    });
    // Clear both headers so resolveBaseUrl hits the "" branch.
    // (Request construction populates Host by default; override.)
    req.headers.delete("host");

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    // callback_url must NOT be present.
    expect(body.callback_url).toBeUndefined();
  });
});
