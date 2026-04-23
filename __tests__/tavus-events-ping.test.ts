// Covers line 52 of app/api/tavus/events/route.ts — the 15-second ping
// interval keep-alive. The existing test drains only the immediate
// header + first event; advancing fake timers by 15 s fires the
// interval at least once.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/tavus/events/route";
import { clearConversation } from "@/lib/tavusEvents";

beforeEach(() => {
  clearConversation("ping-test");
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("/api/tavus/events — keep-alive ping interval", () => {
  it("writes a `: ping` comment after 15 seconds", async () => {
    const res = await GET(
      new Request("http://localhost/api/tavus/events?conversationId=ping-test")
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // First read — the initial `: connected` comment lands synchronously.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain(": connected ping-test");

    // Advance fake timers by 15s to fire the setInterval.
    vi.advanceTimersByTime(15000);

    // Next read should carry the ping frame.
    const ping = await reader.read();
    expect(decoder.decode(ping.value)).toContain(": ping");

    // Release the reader before cancelling (the stream is locked by it).
    reader.releaseLock();
    await res.body?.cancel();
    vi.useRealTimers();
  });
});
