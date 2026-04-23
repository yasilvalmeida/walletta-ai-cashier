import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  publishEvent,
  subscribe,
  clearConversation,
} from "@/lib/tavusEvents";

beforeEach(() => {
  clearConversation("c-throw");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("tavusEvents — history-replay listener throws", () => {
  it("swallows exceptions thrown by a listener during backlog replay", () => {
    // Prime the backlog, then subscribe a listener that throws. The
    // replay-on-subscribe path (line 89 region) must not propagate.
    publishEvent({
      kind: "finalize",
      conversationId: "c-throw",
      timestamp: 1,
    });
    publishEvent({
      kind: "finalize",
      conversationId: "c-throw",
      timestamp: 2,
    });

    let callCount = 0;
    const throwing = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) throw new Error("listener boom");
    });
    expect(() => subscribe("c-throw", throwing)).not.toThrow();
    // Both backlog events still reach the listener — throw from the
    // first does not block the second.
    expect(callCount).toBe(2);
  });

  it("unsubscribe is idempotent even if listeners map has been wiped", () => {
    const listener = vi.fn();
    const unsub = subscribe("c-throw", listener);
    clearConversation("c-throw");
    // Map.delete(listener) on a bucket that no longer exists must be
    // a safe no-op (branch at line 87 region).
    expect(() => unsub()).not.toThrow();
  });
});
