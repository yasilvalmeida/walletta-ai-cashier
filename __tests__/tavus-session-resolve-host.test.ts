// Covers line 48 of app/api/tavus/session/route.ts — the
// resolveBaseUrl success path that assembles proto + host when
// TAVUS_CALLBACK_BASE_URL is unset but the request carries a Host
// header. Our existing tavus-session-route tests either set the env
// var or deliberately drop the host, so neither hits this line.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/tavus/session — resolveBaseUrl Host-header path", () => {
  it("builds callback_url from proto + host headers when env is unset", async () => {
    vi.stubEnv("TAVUS_API_KEY", "tk");
    // Explicitly clear — resolveBaseUrl must fall through to headers.
    vi.stubEnv("TAVUS_CALLBACK_BASE_URL", "");

    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversation_id: "c-host",
            conversation_url: "u",
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { POST } = await import("@/app/api/tavus/session/route");
    // Request with an explicit Host header AND x-forwarded-proto.
    const req = new Request("http://walletta.test/api/tavus/session", {
      method: "POST",
      headers: {
        host: "walletta.test",
        "x-forwarded-proto": "https",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const tavusReqBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    // callback_url is present AND reflects the forwarded proto + host.
    expect(tavusReqBody.callback_url).toBe(
      "https://walletta.test/api/tavus/webhook"
    );
  });
});
