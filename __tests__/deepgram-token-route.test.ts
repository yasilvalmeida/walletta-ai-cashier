import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/deepgram/token", () => {
  it("returns 503 when DEEPGRAM_API_KEY is unset", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    const { POST } = await import("@/app/api/deepgram/token/route");
    const res = await POST();
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toMatch(/not configured/i);
  });

  it("returns the configured key on success (PoC direct-return path)", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-test-key-abc");
    const { POST } = await import("@/app/api/deepgram/token/route");
    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.key).toBe("dg-test-key-abc");
  });

  it("returns 500 if NextResponse.json throws (defensive catch path)", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-test-key-abc");
    // Force the success path to throw so the outer catch block runs.
    const nextServer = await import("next/server");
    const spy = vi
      .spyOn(nextServer.NextResponse, "json")
      .mockImplementationOnce(() => {
        throw new Error("response builder crashed");
      })
      // Allow the catch branch's own NextResponse.json call to proceed.
      .mockImplementation(
        ((...args: unknown[]) => {
          spy.mockRestore();
          return (nextServer.NextResponse.json as (
            ...a: unknown[]
          ) => Response)(...args);
        }) as unknown as typeof nextServer.NextResponse.json
      );
    const { POST } = await import("@/app/api/deepgram/token/route");
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
