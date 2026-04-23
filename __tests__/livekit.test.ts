import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLiveKitToken } from "@/lib/livekit";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchLiveKitToken", () => {
  it("POSTs to /api/livekit/token with the correct body", async () => {
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ token: "jwt-123", url: "wss://lk.example" }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchLiveKitToken("room-A", "alice");

    expect(result).toEqual({ token: "jwt-123", url: "wss://lk.example" });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/livekit/token");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      roomName: "room-A",
      participantName: "alice",
    });
  });

  it("throws a descriptive error when the token endpoint errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 }))
    );
    await expect(fetchLiveKitToken("r", "p")).rejects.toThrow(/500/);
  });
});
