import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  publishEvent,
  subscribe,
  clearConversation,
  type TavusChannelEvent,
} from "@/lib/tavusEvents";

function finalize(id: string): TavusChannelEvent {
  return { kind: "finalize", conversationId: id, timestamp: 1 };
}

function transcript(id: string, speech: string): TavusChannelEvent {
  return {
    kind: "transcript",
    conversationId: id,
    role: "user",
    speech,
    timestamp: 1,
  };
}

beforeEach(() => {
  clearConversation("c1");
  clearConversation("c2");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("tavusEvents pub/sub", () => {
  it("delivers an event to every current subscriber for that conversation", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe("c1", a);
    subscribe("c1", b);
    publishEvent(finalize("c1"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("isolates subscribers by conversationId", () => {
    const a = vi.fn();
    subscribe("c1", a);
    publishEvent(finalize("c2"));
    expect(a).not.toHaveBeenCalled();
  });

  it("replays backlog to late subscribers (SSE reconnect case)", () => {
    publishEvent(transcript("c1", "one"));
    publishEvent(transcript("c1", "two"));
    const listener = vi.fn();
    subscribe("c1", listener);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("caps the backlog at 50 entries per conversation", () => {
    for (let i = 0; i < 60; i++) publishEvent(transcript("c1", `msg-${i}`));
    const listener = vi.fn();
    subscribe("c1", listener);
    expect(listener).toHaveBeenCalledTimes(50);
    // Oldest 10 should have been dropped; first replayed is msg-10.
    expect(listener.mock.calls[0][0]).toMatchObject({ speech: "msg-10" });
  });

  it("unsubscribe stops further deliveries and frees the bucket when empty", () => {
    const a = vi.fn();
    const unsub = subscribe("c1", a);
    unsub();
    publishEvent(finalize("c1"));
    expect(a).not.toHaveBeenCalled();
    // Calling unsub a second time is a safe no-op.
    expect(() => unsub()).not.toThrow();
  });

  it("one listener throwing does not block other listeners", () => {
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    subscribe("c1", bad);
    subscribe("c1", good);
    publishEvent(finalize("c1"));
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("clearConversation wipes both listeners and backlog", () => {
    publishEvent(transcript("c1", "old"));
    clearConversation("c1");
    const listener = vi.fn();
    subscribe("c1", listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
