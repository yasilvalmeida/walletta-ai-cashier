import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  endAllActiveConversations,
  isMaxConcurrentError,
} from "@/lib/tavus";

describe("isMaxConcurrentError", () => {
  it("recognises the Tavus concurrent-cap 400", () => {
    expect(
      isMaxConcurrentError(
        400,
        '{"message":"User has reached maximum concurrent conversations"}'
      )
    ).toBe(true);
    // Phrase-matching is case-insensitive and allows extra whitespace
    // since Tavus has varied the exact wording over time.
    expect(
      isMaxConcurrentError(400, "maximum   concurrent   conversations reached")
    ).toBe(true);
  });

  it("rejects unrelated 400s", () => {
    // Payment-required responses arrive as 402 but have been observed
    // occasionally as 400 with a different message; those must not be
    // retried by the cleanup-and-retry path.
    expect(
      isMaxConcurrentError(400, '{"message":"invalid replica_id"}')
    ).toBe(false);
    expect(isMaxConcurrentError(400, "bad request")).toBe(false);
  });

  it("rejects non-400 status codes even with matching text", () => {
    // Only 400 is the retryable capacity signal — 402 (out of credits)
    // and 5xx must never trigger cleanup.
    expect(
      isMaxConcurrentError(
        402,
        "User has reached maximum concurrent conversations"
      )
    ).toBe(false);
    expect(
      isMaxConcurrentError(
        500,
        "User has reached maximum concurrent conversations"
      )
    ).toBe(false);
  });
});

describe("endAllActiveConversations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ends every non-ended conversation and counts successes", async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("?limit=100")) {
        return new Response(
          JSON.stringify({
            data: [
              { conversation_id: "c1", status: "active" },
              { conversation_id: "c2", status: "ended" },
              { conversation_id: "c3", status: "in_progress" },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await endAllActiveConversations("test-key");

    expect(result.scanned).toBe(3);
    expect(result.ended).toBe(2);
    // The already-ended row must NOT produce an end call.
    expect(calls.some((c) => c.includes("/c2/end"))).toBe(false);
    expect(calls.some((c) => c.includes("/c1/end"))).toBe(true);
    expect(calls.some((c) => c.includes("/c3/end"))).toBe(true);
  });

  it("returns zero-counts if the list call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 }))
    );
    const result = await endAllActiveConversations("test-key");
    expect(result).toEqual({ scanned: 0, ended: 0, details: [] });
  });

  it("paginates with limit=100 to avoid a hidden blocker on page 2", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      urls.push(input.toString());
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await endAllActiveConversations("test-key");
    expect(urls[0]).toContain("limit=100");
  });
});
