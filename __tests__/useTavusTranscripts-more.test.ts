// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

interface FakeES {
  url: string;
  onmessage: ((evt: { data: string }) => void) | null;
  close: () => void;
}
let sources: FakeES[] = [];

class MockES implements FakeES {
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
  vi.stubGlobal("EventSource", MockES);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Note: line 76 (`if (typeof window === "undefined") return`) is an SSR
// guard. We can't exercise it in renderHook because React itself needs
// window to mount. Left as a documented unreachable-in-test path.

describe("useTavusTranscripts — unknown kind falls through (line 102 else)", () => {
  it("silently drops events whose kind is not transcript/cart_action/finalize", async () => {
    const { useTavusTranscripts } = await import(
      "@/hooks/useTavusTranscripts"
    );
    const onUserTranscript = vi.fn();
    const onCartAction = vi.fn();
    const onFinalize = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onUserTranscript,
        onCartAction,
        onFinalize,
      })
    );
    act(() => {
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "future_event_type",
          conversationId: "c1",
          timestamp: 0,
        }),
      });
    });
    expect(onUserTranscript).not.toHaveBeenCalled();
    expect(onCartAction).not.toHaveBeenCalled();
    expect(onFinalize).not.toHaveBeenCalled();
  });
});

describe("useTavusTranscripts — non-user role transcripts are ignored", () => {
  it("drops transcripts with role='system' (neither user nor replica)", async () => {
    const { useTavusTranscripts } = await import(
      "@/hooks/useTavusTranscripts"
    );
    const onUserTranscript = vi.fn();
    const onReplicaTranscript = vi.fn();
    renderHook(() =>
      useTavusTranscripts({
        conversationIds: ["c1"],
        onUserTranscript,
        onReplicaTranscript,
      })
    );
    act(() => {
      sources[0].onmessage?.({
        data: JSON.stringify({
          kind: "transcript",
          conversationId: "c1",
          role: "system",
          speech: "housekeeping line",
          timestamp: 0,
        }),
      });
    });
    // Neither handler fires — line 94 (role !== "user") branch.
    expect(onUserTranscript).not.toHaveBeenCalled();
    expect(onReplicaTranscript).not.toHaveBeenCalled();
  });

  it("drops cart_action when no handler is subscribed", async () => {
    const { useTavusTranscripts } = await import(
      "@/hooks/useTavusTranscripts"
    );
    renderHook(() =>
      useTavusTranscripts({ conversationIds: ["c1"] })
    );
    // No onCartAction handler passed — branch at line 98-100 where
    // cartActionRef.current is undefined must not throw.
    expect(() => {
      act(() => {
        sources[0].onmessage?.({
          data: JSON.stringify({
            kind: "cart_action",
            conversationId: "c1",
            action: "add",
            payload: { product_id: "x", product_name: "x", quantity: 1, unit_price: 1 },
            timestamp: 0,
          }),
        });
      });
    }).not.toThrow();
  });

  it("drops finalize when no handler is subscribed", async () => {
    const { useTavusTranscripts } = await import(
      "@/hooks/useTavusTranscripts"
    );
    renderHook(() =>
      useTavusTranscripts({ conversationIds: ["c1"] })
    );
    expect(() => {
      act(() => {
        sources[0].onmessage?.({
          data: JSON.stringify({
            kind: "finalize",
            conversationId: "c1",
            timestamp: 0,
          }),
        });
      });
    }).not.toThrow();
  });
});
