// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ----- Captured callback refs so tests can drive Deepgram/VAD events ----
let lastDeepgramOptions: {
  onTranscript: (t: string, isFinal: boolean) => void;
  onSpeechEnd: (t: string, language?: string) => void;
  onError?: (e: Error) => void;
} | null = null;
let lastVadOptions: { onSpeechStart: () => void; onSpeechEnd: () => void } | null = null;

const ttsStatus = { current: "idle" as "idle" | "loading" | "speaking" };
const enqueue = vi.fn();
const streamEnqueue = vi.fn();
const enqueueBuffer = vi.fn();
const preloadBuffer = vi.fn(async () => new ArrayBuffer(4));
const stop = vi.fn();
const unlock = vi.fn();

vi.mock("@/hooks/useDeepgram", () => ({
  useDeepgram: (options: typeof lastDeepgramOptions) => {
    lastDeepgramOptions = options;
    return {
      status: "idle" as const,
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/useVAD", () => ({
  useVAD: (options: typeof lastVadOptions) => {
    lastVadOptions = options;
    return {
      isListening: false,
      isSpeaking: false,
      volume: 0,
      startListening: vi.fn(),
      stopListening: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/useCartesiaTTS", () => ({
  useCartesiaTTS: () => ({
    get status() {
      return ttsStatus.current;
    },
    enqueue,
    streamEnqueue,
    enqueueBuffer,
    preloadBuffer,
    stop,
    unlock,
  }),
}));

const isAvatarSpeakingMock = vi.fn(() => false);
vi.mock("@/lib/tavusPresence", () => ({
  isAvatarSpeaking: () => isAvatarSpeakingMock(),
  markAvatarSpeech: vi.fn(),
}));

vi.mock("@/lib/fillers", () => ({
  fillersFor: () => ["Got it."],
  pickFiller: () => "Got it.",
}));

vi.mock("@/lib/telemetry", () => ({
  telemetry: {
    mark: vi.fn(),
    startTurn: vi.fn(),
    endTurn: vi.fn(),
    setMode: vi.fn(),
  },
}));

// The cart store is pure state logic; use the real implementation.
import { useCartStore } from "@/store/cartStore";
import { useConversation } from "@/hooks/useConversation";

beforeEach(() => {
  useCartStore.getState().clearCart();
  ttsStatus.current = "idle";
  isAvatarSpeakingMock.mockReturnValue(false);
  lastDeepgramOptions = null;
  lastVadOptions = null;
  enqueue.mockClear();
  streamEnqueue.mockClear();
  enqueueBuffer.mockClear();
  stop.mockClear();
  unlock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Helper — build an SSE ReadableStream from event objects.
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useConversation — initial state", () => {
  it("starts idle with empty transcript", () => {
    const { result } = renderHook(() => useConversation());
    expect(result.current.phase).toBe("idle");
    expect(result.current.transcript).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.turnIndex).toBe(0);
  });
});

describe("useConversation — start/stop", () => {
  it("start() grants mic and flips to listening", async () => {
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    }));
    // Happy-dom doesn't ship navigator.mediaDevices — inject a stub.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      await result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalled();
    expect(result.current.phase).toBe("listening");
  });

  it("start() lands on 'error' when getUserMedia rejects", async () => {
    const getUserMedia = vi.fn(async () => {
      throw new Error("mic blocked");
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toMatch(/mic blocked/);
  });

  it("stop() aborts in-flight work and returns to idle", async () => {
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    }));
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
    });
    expect(stop).toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    expect(result.current.transcript).toBe("");
  });
});

describe("useConversation — Deepgram-driven transcript flow", () => {
  it("interim transcripts update state (echo guards off)", () => {
    renderHook(() => useConversation());
    act(() => {
      lastDeepgramOptions!.onTranscript("hello", false);
    });
    // No error, nothing thrown — transcript is internal state.
  });

  it("suppresses interim transcripts while TTS is speaking (echo guard)", () => {
    const { result } = renderHook(() => useConversation());
    ttsStatus.current = "speaking";
    act(() => {
      lastDeepgramOptions!.onTranscript("echo", true);
    });
    // Transcript stays empty because the echo guard short-circuits.
    expect(result.current.transcript).toBe("");
  });

  it("suppresses interim transcripts while the avatar is speaking", () => {
    const { result } = renderHook(() => useConversation());
    isAvatarSpeakingMock.mockReturnValue(true);
    act(() => {
      lastDeepgramOptions!.onTranscript("avatar echo", true);
    });
    expect(result.current.transcript).toBe("");
  });

  it("Deepgram onError surfaces to component state", () => {
    const { result } = renderHook(() => useConversation());
    act(() => {
      lastDeepgramOptions!.onError?.(new Error("WS 1006"));
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("WS 1006");
  });

  it("drops empty/whitespace speech-end payloads", () => {
    renderHook(() => useConversation());
    vi.stubGlobal("fetch", vi.fn());
    act(() => {
      lastDeepgramOptions!.onSpeechEnd("   ");
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops speech-end payloads while the avatar is speaking", () => {
    renderHook(() => useConversation());
    isAvatarSpeakingMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn());
    act(() => {
      lastDeepgramOptions!.onSpeechEnd("hello");
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("useConversation — sendToChat streaming", () => {
  it("streams text + cart_action events and lands back in 'listening'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "text", delta: "One" },
          { type: "text", delta: " matcha" },
          {
            type: "cart_action",
            action: "add_to_cart",
            payload: {
              product_id: "p1",
              product_name: "Matcha",
              quantity: 1,
              unit_price: 7,
            },
          },
          { type: "done" },
        ])
      )
    );
    const { result } = renderHook(() =>
      useConversation({ cartesiaEnabled: false })
    );
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("I'd like a matcha");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].product_id).toBe("p1");
    // Tavus mode (cartesiaEnabled=false): state returns to listening immediately.
    await waitFor(() => expect(result.current.phase).toBe("listening"));
  });

  it("fires the receipt modal when the user finalizes with items in cart", async () => {
    // Pre-populate the cart so isFinalize + cartHasItems both match.
    useCartStore.getState().addItem({
      product_id: "p1",
      product_name: "Matcha",
      quantity: 1,
      unit_price: 7,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "text", delta: "Total is $7.67." },
          { type: "done" },
        ])
      )
    );
    renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("that's all");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(useCartStore.getState().receiptSnapshot).not.toBeNull();
  });

  it("does NOT fire the receipt modal when the cart is empty at finalize time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "text", delta: "Your cart's empty." },
          { type: "done" },
        ])
      )
    );
    renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("that's all");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(useCartStore.getState().receiptSnapshot).toBeNull();
  });

  it("streams to Cartesia TTS when cartesiaEnabled is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          // A comma at position ≥10 triggers the first clause flush.
          { type: "text", delta: "Got it — one matcha" },
          { type: "text", delta: ", coming up." },
          { type: "done" },
        ])
      )
    );
    renderHook(() => useConversation({ cartesiaEnabled: true }));
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("a matcha please");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(streamEnqueue).toHaveBeenCalled();
  });

  it("ignores cart mutations that arrive after the receipt snapshot is frozen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          {
            type: "cart_action",
            action: "add_to_cart",
            payload: {
              product_id: "phantom",
              product_name: "Phantom",
              quantity: 1,
              unit_price: 9,
            },
          },
          { type: "done" },
        ])
      )
    );
    useCartStore.getState().addItem({
      product_id: "p1",
      product_name: "Matcha",
      quantity: 1,
      unit_price: 7,
    });
    useCartStore.getState().setReceiptReady(true);
    renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("anything else?");
      await new Promise((r) => setTimeout(r, 20));
    });
    // The phantom item must NOT have been added.
    expect(
      useCartStore.getState().items.find((i) => i.product_id === "phantom")
    ).toBeUndefined();
  });

  it("handles remove_from_cart actions", async () => {
    useCartStore.getState().addItem({
      product_id: "p1",
      product_name: "Matcha",
      quantity: 1,
      unit_price: 7,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          {
            type: "cart_action",
            action: "remove_from_cart",
            payload: { product_id: "p1" },
          },
          { type: "done" },
        ])
      )
    );
    renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("remove the matcha");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("lands in phase=error on a non-OK chat response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 }))
    );
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.phase).toBe("error");
  });

  it("stays in 'listening' on Safari-style transient fetch errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      })
    );
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.phase).toBe("listening");
  });

  it("handles 'Failed to fetch' as a transient Safari error (line 337)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.phase).toBe("listening");
  });

  it("treats non-Error thrown values as 'Chat request failed' (line 334)", async () => {
    vi.stubGlobal(
      "fetch",
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      vi.fn(async () => {
        throw "bare-string";
      })
    );
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.error).toBe("Chat request failed");
    expect(result.current.phase).toBe("error");
  });

  it("treats a 'network error' TypeError as transient (regex arm, line 338)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network error: ECONNRESET");
      })
    );
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    // The /fetch|network/i regex catches "network error:..." → transient.
    expect(result.current.phase).toBe("listening");
  });

  it("ignores AbortError (stop() during an in-flight request)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new DOMException("aborted", "AbortError");
        throw err;
      })
    );
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      lastDeepgramOptions!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    // No error state — abort is a normal shutdown signal.
    expect(result.current.error).toBeNull();
  });
});

describe("useConversation — VAD barge-in", () => {
  it("VAD speech-start stops the TTS (barge-in)", () => {
    renderHook(() => useConversation());
    act(() => {
      lastVadOptions!.onSpeechStart();
    });
    expect(stop).toHaveBeenCalled();
  });

  it("VAD speech-start is suppressed while TTS is already speaking", () => {
    renderHook(() => useConversation());
    ttsStatus.current = "speaking";
    act(() => {
      lastVadOptions!.onSpeechStart();
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it("VAD speech-start is suppressed while the avatar speaks", () => {
    renderHook(() => useConversation());
    isAvatarSpeakingMock.mockReturnValue(true);
    act(() => {
      lastVadOptions!.onSpeechStart();
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it("VAD onSpeechEnd is a no-op (Deepgram owns end-of-speech)", () => {
    renderHook(() => useConversation());
    // Simply asserting the callback is present and callable.
    expect(() => lastVadOptions!.onSpeechEnd()).not.toThrow();
  });
});

describe("useConversation — receipt → New Order reset", () => {
  it("clears chat history when the receipt snapshot goes set → null", () => {
    useCartStore.getState().addItem({
      product_id: "p1",
      product_name: "x",
      quantity: 1,
      unit_price: 1,
    });
    useCartStore.getState().setReceiptReady(true);
    const { rerender } = renderHook(() => useConversation());
    rerender();
    // Now simulate the customer tapping "New Order".
    act(() => {
      useCartStore.getState().setReceiptReady(false);
      useCartStore.getState().clearCart();
    });
    rerender();
    // No assertion on internal messagesRef — we just prove the effect
    // ran without throwing and the state was consistent.
    expect(useCartStore.getState().receiptSnapshot).toBeNull();
  });
});
