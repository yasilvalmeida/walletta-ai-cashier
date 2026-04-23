// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTavusTranscripts } from "@/hooks/useTavusTranscripts";

// Capture every EventSource instance created by the hook so tests can
// push messages / errors through them.
interface FakeES {
  url: string;
  onmessage: ((evt: { data: string }) => void) | null;
  onerror: ((err: unknown) => void) | null;
  close: () => void;
}
let sources: FakeES[] = [];

class MockEventSource implements FakeES {
  url: string;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    sources.push(this);
  }
}

beforeEach(() => {
  sources = [];
  vi.stubGlobal("EventSource", MockEventSource);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTavusTranscripts", () => {
  it("opens one EventSource per conversationId", () => {
    renderHook(() =>
      useTavusTranscripts({ conversationIds: ["a", "b"] })
    );
    expect(sources).toHaveLength(2);
    expect(sources[0].url).toContain("conversationId=a");
    expect(sources[1].url).toContain("conversationId=b");
  });

  it("routes user transcripts to onUserTranscript", () => {
    const onUserTranscript = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onUserTranscript,
      })
    );
    act(() => {
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "transcript",
          conversationId: "c1",
          role: "user",
          speech: "hello",
          timestamp: 0,
        }),
      });
    });
    expect(onUserTranscript).toHaveBeenCalledWith("hello");
  });

  it("routes replica transcripts to onReplicaTranscript (echo-guard path)", () => {
    const onReplicaTranscript = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onReplicaTranscript,
      })
    );
    act(() => {
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "transcript",
          conversationId: "c1",
          role: "replica",
          speech: "I hear you.",
          timestamp: 0,
        }),
      });
    });
    expect(onReplicaTranscript).toHaveBeenCalledWith("I hear you.");
  });

  it("ignores transcripts with an empty speech body", () => {
    const onUserTranscript = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onUserTranscript,
      })
    );
    act(() => {
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "transcript",
          conversationId: "c1",
          role: "user",
          speech: "   ",
          timestamp: 0,
        }),
      });
    });
    expect(onUserTranscript).not.toHaveBeenCalled();
  });

  it("drops events whose conversationId is not in the subscribed set", () => {
    const onUserTranscript = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onUserTranscript,
      })
    );
    act(() => {
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "transcript",
          conversationId: "other",
          role: "user",
          speech: "spy",
          timestamp: 0,
        }),
      });
    });
    expect(onUserTranscript).not.toHaveBeenCalled();
  });

  it("forwards cart_action and finalize events", () => {
    const onCartAction = vi.fn();
    const onFinalize = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onCartAction,
        onFinalize,
      })
    );
    act(() => {
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "cart_action",
          conversationId: "c1",
          action: "add",
          payload: { product_id: "p1", product_name: "x", quantity: 1, unit_price: 4 },
          timestamp: 0,
        }),
      });
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "finalize",
          conversationId: "c1",
          timestamp: 0,
        }),
      });
    });
    expect(onCartAction).toHaveBeenCalledWith(
      "add",
      expect.objectContaining({ product_id: "p1" })
    );
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it("swallows malformed JSON without crashing the stream", () => {
    const onUserTranscript = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onUserTranscript,
      })
    );
    act(() => {
      sources[0].onmessage?.({ data: "not json" });
    });
    expect(onUserTranscript).not.toHaveBeenCalled();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() =>
      useTavusTranscripts({ conversationIds: ["c1"] })
    );
    const source = sources[0];
    unmount();
    expect(source.close).toHaveBeenCalled();
  });

  it("treats an empty id list as zero subscriptions", () => {
    renderHook(() => useTavusTranscripts({ conversationIds: [] }));
    expect(sources).toHaveLength(0);
  });
});
