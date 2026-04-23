// Covers the remaining sse.ts branches: lines without "data:" prefix,
// empty-string data payload, and unknown event.type.

import { describe, it, expect, vi } from "vitest";
import { parseSSEStream } from "@/lib/sse";

describe("lib/sse — remaining branches", () => {
  it("skips lines without a 'data:' prefix (comment lines, ping frames)", async () => {
    const body = new Response(": ping\n\ndata: {\"type\":\"done\"}\n\n").body;
    const onDone = vi.fn();
    await parseSSEStream({ body } as unknown as Response, {
      onText: vi.fn(),
      onCartAction: vi.fn(),
      onDone,
      onError: vi.fn(),
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("skips 'data: ' lines with empty payload", async () => {
    const body = new Response("data: \n\ndata: {\"type\":\"done\"}\n\n").body;
    const onDone = vi.fn();
    await parseSSEStream({ body } as unknown as Response, {
      onText: vi.fn(),
      onCartAction: vi.fn(),
      onDone,
      onError: vi.fn(),
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ignores events with unknown 'type' values (forward-compat)", async () => {
    const onText = vi.fn();
    const onCartAction = vi.fn();
    const onDone = vi.fn();
    const body = new Response(
      `data: ${JSON.stringify({ type: "future_event" })}\n\n` +
        `data: ${JSON.stringify({ type: "done" })}\n\n`
    ).body;
    await parseSSEStream({ body } as unknown as Response, {
      onText,
      onCartAction,
      onDone,
      onError: vi.fn(),
    });
    expect(onText).not.toHaveBeenCalled();
    expect(onCartAction).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
