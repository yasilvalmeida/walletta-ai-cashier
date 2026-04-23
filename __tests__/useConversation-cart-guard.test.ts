// @vitest-environment happy-dom
//
// Covers the `if (event.type !== "cart_action") return;` defensive
// type-guard at useConversation.ts:248. parseSSEStream normally filters
// events by type before invoking onCartAction, so the guard is dead in
// production. We mock parseSSEStream to call onCartAction with a non-
// cart_action event and assert the guard fires (no addItem/removeItem
// side effects).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let lastDg: {
  onSpeechEnd: (t: string, l?: string) => void;
} | null = null;

vi.mock("@/hooks/useDeepgram", () => ({
  useDeepgram: (opts: typeof lastDg) => {
    lastDg = opts;
    return { status: "idle", connect: vi.fn(), disconnect: vi.fn() };
  },
}));
vi.mock("@/hooks/useVAD", () => ({
  useVAD: () => ({
    isListening: false,
    isSpeaking: false,
    volume: 0,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCartesiaTTS", () => ({
  useCartesiaTTS: () => ({
    status: "idle",
    enqueue: vi.fn(),
    streamEnqueue: vi.fn(),
    enqueueBuffer: vi.fn(),
    preloadBuffer: vi.fn(async () => null),
    stop: vi.fn(),
    unlock: vi.fn(),
  }),
}));
vi.mock("@/lib/tavusPresence", () => ({
  isAvatarSpeaking: () => false,
  markAvatarSpeech: vi.fn(),
}));
vi.mock("@/lib/fillers", () => ({
  fillersFor: () => [],
  pickFiller: () => "",
}));
vi.mock("@/lib/telemetry", () => ({
  telemetry: {
    mark: vi.fn(),
    setMode: vi.fn(),
    endTurn: vi.fn(),
  },
}));

// Mock parseSSEStream to invoke callbacks directly, bypassing its
// normal type filtering so we can drive the useConversation guard.
vi.mock("@/lib/sse", () => ({
  parseSSEStream: async (
    _response: Response,
    callbacks: {
      onText: (delta: string) => void;
      onCartAction: (event: { type: string }) => void;
      onDone: () => void;
      onError: (error: Error) => void;
    }
  ) => {
    // Dispatch a non-cart_action event via the cart-action callback.
    // useConversation's guard `if (event.type !== "cart_action") return`
    // must bail without mutating the cart.
    callbacks.onCartAction({ type: "text" });
    callbacks.onDone();
  },
}));

import { useCartStore } from "@/store/cartStore";
import { useConversation } from "@/hooks/useConversation";

beforeEach(() => {
  useCartStore.getState().clearCart();
  lastDg = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useConversation — cart_action type guard", () => {
  it("bails at the type guard when onCartAction receives a non-cart event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
      )
    );
    renderHook(() => useConversation());
    await act(async () => {
      lastDg!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    // Our mock fired onCartAction with a non-cart event — the guard
    // stopped it before addItem could run.
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});
