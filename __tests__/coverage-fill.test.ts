// Targeted tests for the final uncovered branches.
// Each block here exists specifically to land on a line that the rest of
// the suite doesn't reach.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---- lib/sse: no-body branch + iterator throw branch ---------------------

describe("lib/sse — error edges", () => {
  it("onError fires when the response has no body", async () => {
    const { parseSSEStream } = await import("@/lib/sse");
    const onError = vi.fn();
    await parseSSEStream(
      { body: null } as unknown as Response,
      {
        onText: vi.fn(),
        onCartAction: vi.fn(),
        onDone: vi.fn(),
        onError,
      }
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/no response body/i);
  });

  it("onError fires when the reader throws non-Error values", async () => {
    const { parseSSEStream } = await import("@/lib/sse");
    const reader = {
      read: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "string-error";
      }),
      releaseLock: vi.fn(),
    };
    const body = { getReader: () => reader } as unknown as ReadableStream;
    const onError = vi.fn();
    await parseSSEStream({ body } as unknown as Response, {
      onText: vi.fn(),
      onCartAction: vi.fn(),
      onDone: vi.fn(),
      onError,
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ---- lib/telemetry: exercise every TelemetryBus entry point ----------

describe("lib/telemetry — TelemetryBus complete surface", () => {
  it("setMode / mark / endTurn / subscribe / snapshot / currentTurn / reset all work", async () => {
    const { telemetry } = await import("@/lib/telemetry");
    telemetry.reset();
    // setMode before any turn → silent no-op.
    telemetry.setMode("tavus");
    expect(telemetry.currentTurn()).toBeNull();

    const listener = vi.fn();
    const unsubscribe = telemetry.subscribe(listener);
    telemetry.mark("speechStart");
    telemetry.setMode("cartesia");
    telemetry.mark("speechEnd", { language: "es" });
    telemetry.endTurn();
    expect(listener).toHaveBeenCalledTimes(1);
    const t = listener.mock.calls[0][0] as { language?: string; mode?: string };
    expect(t.language).toBe("es");
    expect(t.mode).toBe("cartesia");

    expect(telemetry.snapshot()).toHaveLength(1);

    // Fill >50 turns to exercise the history-cap shift.
    for (let i = 0; i < 55; i++) {
      telemetry.mark("speechStart");
      telemetry.endTurn();
    }
    expect(telemetry.snapshot()).toHaveLength(50);

    unsubscribe();
    telemetry.reset();
    expect(telemetry.snapshot()).toHaveLength(0);
  });

  it("a mark fired twice on the same turn ignores the second call", async () => {
    const { telemetry } = await import("@/lib/telemetry");
    telemetry.reset();
    telemetry.mark("speechStart");
    const firstTurn = telemetry.currentTurn();
    const first = firstTurn?.marks.speechStart;
    telemetry.mark("speechStart");
    expect(telemetry.currentTurn()?.marks.speechStart).toBe(first);
    telemetry.reset();
  });

  it("endTurn is a no-op when no current turn exists", async () => {
    const { telemetry } = await import("@/lib/telemetry");
    telemetry.reset();
    expect(() => telemetry.endTurn()).not.toThrow();
    expect(telemetry.snapshot()).toHaveLength(0);
  });
});

// ---- lib/tavus: endAllActiveConversations end-fetch throw branch ------

describe("lib/tavus — /end fetch throws", () => {
  it("records an error detail when a single /end call throws", async () => {
    const { endAllActiveConversations } = await import("@/lib/tavus");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url.includes("?limit=100")) {
          return new Response(
            JSON.stringify({
              data: [{ conversation_id: "c1", status: "active" }],
            }),
            { status: 200 }
          );
        }
        if (url.includes("/end")) {
          throw new Error("net down");
        }
        return new Response("{}", { status: 200 });
      })
    );
    const res = await endAllActiveConversations("tk");
    expect(res.ended).toBe(0);
    expect(res.details[0].ok).toBe(false);
    expect(res.details[0].error).toMatch(/net down/);
  });
});

// ---- lib/cart: calculateSubtotal + calculateTax + calculateTotal ------

describe("lib/cart — calculateSubtotal / Tax / Total wrappers", () => {
  it("wrapper helpers mirror line-level math", async () => {
    const { calculateSubtotal, calculateTax, calculateTotal } = await import(
      "@/lib/cart"
    );
    const items = [
      {
        product_id: "a",
        product_name: "A",
        quantity: 1,
        unit_price: 10,
        line_total: 10,
      },
      {
        product_id: "b",
        product_name: "B",
        quantity: 1,
        unit_price: 2,
        line_total: 2,
      },
    ];
    expect(calculateSubtotal(items)).toBe(12);
    expect(calculateTax(12)).toBeCloseTo(1.14);
    expect(calculateTotal(items)).toBeCloseTo(13.14);
  });

  it("removeItemFromCart is a no-op when no line matches", async () => {
    const { removeItemFromCart } = await import("@/lib/cart");
    const items = [
      {
        product_id: "a",
        product_name: "A",
        quantity: 1,
        unit_price: 1,
        line_total: 1,
      },
    ];
    expect(removeItemFromCart(items, "zzz")).toBe(items);
  });

  it("addItemToCart merges quantity for an identical line", async () => {
    const { addItemToCart } = await import("@/lib/cart");
    const items: Array<{
      product_id: string;
      product_name: string;
      quantity: number;
      unit_price: number;
      line_total: number;
    }> = [];
    const first = addItemToCart(items, {
      product_id: "a",
      product_name: "A",
      quantity: 1,
      unit_price: 3,
    });
    const second = addItemToCart(first, {
      product_id: "a",
      product_name: "A",
      quantity: 2,
      unit_price: 3,
    });
    expect(second).toHaveLength(1);
    expect(second[0].quantity).toBe(3);
    expect(second[0].line_total).toBe(9);
  });
});

// ---- app/api/chat — formatProductForPrompt branches (sizes/modifiers) -
// The real catalog (data/products.json) contains drinks with sizes and
// pastries with customizations — both branches are already hit via the
// existing chat-route.test.ts streaming tests. No extra test needed here.

// ---- useTavus: pagehide / beforeunload listeners fire the end beacon --

describe("useTavus — window unload listeners", () => {
  it("pagehide fires the end beacon for an active session", async () => {
    // Dynamic import under a happy-dom window so window.addEventListener exists.
    const happyDom = await import("happy-dom");
    const win = new happyDom.Window();
    vi.stubGlobal("window", win as unknown as Window);
    vi.stubGlobal("document", win.document);
    vi.stubGlobal("navigator", win.navigator);

    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(win.navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ conversationId: "cX", conversationUrl: "u" }),
            { status: 200 }
          )
      )
    );

    const { renderHook, act } = await import("@testing-library/react");
    const { useTavus } = await import("@/hooks/useTavus");
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    expect(sendBeacon).not.toHaveBeenCalled();
    // Dispatch pagehide on the happy-dom window.
    act(() => {
      win.dispatchEvent(new win.Event("pagehide"));
    });
    expect(sendBeacon).toHaveBeenCalled();
  });
});

// ---- useTavusTranscripts: EventSource onerror path --------------------

describe("useTavusTranscripts — EventSource onerror", () => {
  it("logs but does not crash when the SSE connection errors", async () => {
    const happyDom = await import("happy-dom");
    const win = new happyDom.Window();
    vi.stubGlobal("window", win as unknown as Window);
    vi.stubGlobal("document", win.document);

    let onerror: ((e: unknown) => void) | null = null;
    class FakeES {
      onmessage: ((evt: { data: string }) => void) | null = null;
      set onerror(fn: (e: unknown) => void) {
        onerror = fn;
      }
      close = vi.fn();
      constructor(public url: string) {}
    }
    vi.stubGlobal("EventSource", FakeES);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { renderHook } = await import("@testing-library/react");
    const { useTavusTranscripts } = await import(
      "@/hooks/useTavusTranscripts"
    );
    renderHook(() => useTavusTranscripts({ conversationIds: ["c-err"] }));
    expect(() => onerror?.(new Event("error"))).not.toThrow();
  });
});

// ---- useTavus: autoConnect unmount fires sendBeacon ------------------

describe("useTavus — autoConnect cleanup on unmount", () => {
  it("unmounting with an active session fires the end beacon", async () => {
    const happyDom = await import("happy-dom");
    const win = new happyDom.Window();
    vi.stubGlobal("window", win as unknown as Window);
    vi.stubGlobal("document", win.document);
    vi.stubGlobal("navigator", win.navigator);

    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(win.navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ conversationId: "c-unmount", conversationUrl: "u" }),
            { status: 200 }
          )
      )
    );

    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useTavus } = await import("@/hooks/useTavus");
    const { result, unmount } = renderHook(() =>
      useTavus({ autoConnect: true, warmupDelayMs: 0 })
    );
    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });
    sendBeacon.mockClear();
    unmount();
    expect(sendBeacon).toHaveBeenCalled();
  });

  it("beforeunload also fires the end beacon", async () => {
    const happyDom = await import("happy-dom");
    const win = new happyDom.Window();
    vi.stubGlobal("window", win as unknown as Window);
    vi.stubGlobal("document", win.document);
    vi.stubGlobal("navigator", win.navigator);

    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(win.navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ conversationId: "c-bye", conversationUrl: "u" }),
            { status: 200 }
          )
      )
    );

    const { renderHook, act } = await import("@testing-library/react");
    const { useTavus } = await import("@/hooks/useTavus");
    const { result } = renderHook(() => useTavus());
    await act(async () => {
      await result.current.connect();
    });
    sendBeacon.mockClear();
    act(() => {
      win.dispatchEvent(new win.Event("beforeunload"));
    });
    expect(sendBeacon).toHaveBeenCalled();
  });
});

// ---- useDeepgram line 205: clears a stale speechTimer on a second is_final

describe("useDeepgram — stacked is_final frames reset the fallback timer", () => {
  it("a second is_final clears the first fallback timer", async () => {
    const happyDom = await import("happy-dom");
    const win = new happyDom.Window();
    vi.stubGlobal("window", win as unknown as Window);
    vi.stubGlobal("document", win.document);

    // Fresh WebSocket mock captured on import.
    let ws: {
      onopen: (() => void) | null;
      onmessage: ((ev: { data: string }) => void) | null;
      onclose: null;
      onerror: null;
      readyState: number;
      sent: unknown[];
      send: (d: unknown) => void;
      close: () => void;
    } | null = null;
    class MockWS {
      static OPEN = 1;
      static CLOSED = 3;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose = null;
      onerror = null;
      readyState = 1;
      sent: unknown[] = [];
      constructor() {
        ws = this as unknown as typeof ws;
      }
      send(d: unknown) {
        this.sent.push(d);
      }
      close() {
        this.readyState = MockWS.CLOSED;
      }
    }
    vi.stubGlobal("WebSocket", MockWS);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ key: "k" }), { status: 200 })
      )
    );
    vi.doMock("@/lib/audio", () => ({
      getSharedAudioContext: () => ({
        sampleRate: 16000,
        createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
        createScriptProcessor: () => ({
          onaudioprocess: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        destination: {},
      }),
    }));
    vi.doMock("@/lib/telemetry", () => ({
      telemetry: { mark: vi.fn() },
    }));

    vi.useFakeTimers();
    const { renderHook, act } = await import("@testing-library/react");
    const { useDeepgram } = await import("@/hooks/useDeepgram");
    const onSpeechEnd = vi.fn();
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd })
    );
    await act(async () => {
      await result.current.connect({
        getTracks: () => [{ stop: vi.fn() }],
      } as unknown as MediaStream);
    });
    act(() => {
      ws!.onopen?.();
    });
    // First is_final — arms the 1500 ms fallback timer.
    act(() => {
      ws!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "hello", confidence: 0.9 }] },
          is_final: true,
        }),
      });
    });
    // Second is_final — line 205 clears the first timer before arming a new one.
    act(() => {
      ws!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "world", confidence: 0.9 }] },
          is_final: true,
        }),
      });
    });
    // The fresh timer fires the final flush.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onSpeechEnd).toHaveBeenCalledWith("hello world", undefined);
    vi.useRealTimers();
  });
});

// ---- useConversation line 321-323: SSE parse error lands in phase=error

describe("useConversation — SSE parse error surfaces phase=error", () => {
  it("emits an SSE 'error' event and the hook lands on error state", async () => {
    const happyDom = await import("happy-dom");
    const win = new happyDom.Window();
    vi.stubGlobal("window", win as unknown as Window);
    vi.stubGlobal("document", win.document);

    // Minimal scaffolding — reuse the mocks from useConversation.test.ts.
    let dgOptions: { onSpeechEnd: (t: string, l?: string) => void } | null = null;
    vi.doMock("@/hooks/useDeepgram", () => ({
      useDeepgram: (opts: typeof dgOptions) => {
        dgOptions = opts;
        return { status: "idle", connect: vi.fn(), disconnect: vi.fn() };
      },
    }));
    vi.doMock("@/hooks/useVAD", () => ({
      useVAD: () => ({
        isListening: false,
        isSpeaking: false,
        volume: 0,
        startListening: vi.fn(),
        stopListening: vi.fn(),
      }),
    }));
    vi.doMock("@/hooks/useCartesiaTTS", () => ({
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
    vi.doMock("@/lib/fillers", () => ({
      fillersFor: () => [],
      pickFiller: () => "",
    }));
    vi.doMock("@/lib/telemetry", () => ({
      telemetry: {
        mark: vi.fn(),
        setMode: vi.fn(),
        endTurn: vi.fn(),
      },
    }));
    vi.doMock("@/lib/tavusPresence", () => ({
      isAvatarSpeaking: () => false,
    }));

    // Respond with a real ReadableStream that errors mid-flow.
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("stream blew up mid-flow"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    );

    const { renderHook, act, waitFor } = await import("@testing-library/react");
    const { useConversation } = await import("@/hooks/useConversation");
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      dgOptions!.onSpeechEnd("hello");
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toMatch(/stream blew up/);
  });
});

// ---- lib/sse line 35: done=true on the first read ---------------------

describe("lib/sse — empty stream just closes cleanly", () => {
  it("does not call onDone/onText/onCartAction when body is immediately done", async () => {
    const { parseSSEStream } = await import("@/lib/sse");
    const onText = vi.fn();
    const onDone = vi.fn();
    const onCartAction = vi.fn();
    const onError = vi.fn();
    const body = {
      getReader: () => ({
        read: vi.fn(async () => ({ done: true, value: undefined })),
        releaseLock: vi.fn(),
      }),
    };
    await parseSSEStream({ body } as unknown as Response, {
      onText,
      onCartAction,
      onDone,
      onError,
    });
    expect(onText).not.toHaveBeenCalled();
    expect(onCartAction).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips malformed JSON lines without crashing", async () => {
    const { parseSSEStream } = await import("@/lib/sse");
    const onText = vi.fn();
    const body = new Response("data: {not json}\n\ndata: done\n\n").body;
    await parseSSEStream({ body } as unknown as Response, {
      onText,
      onCartAction: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    });
    expect(onText).not.toHaveBeenCalled();
  });
});

// ---- lib/cart line 59: addItemToCart short-circuit for non-matching key

describe("lib/cart — addItemToCart path coverage", () => {
  it("preserves unrelated items when the incoming key matches a specific line", async () => {
    const { addItemToCart } = await import("@/lib/cart");
    const items = [
      {
        product_id: "americano",
        product_name: "A",
        quantity: 1,
        unit_price: 4,
        line_total: 4,
      },
      {
        product_id: "matcha",
        product_name: "M",
        quantity: 1,
        unit_price: 7,
        line_total: 7,
      },
    ];
    // Add another matcha — the map iteration must leave the americano
    // untouched (branch at line 59).
    const next = addItemToCart(items, {
      product_id: "matcha",
      product_name: "M",
      quantity: 1,
      unit_price: 7,
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(items[0]); // same reference — branch returns `i` unchanged
    expect(next[1].quantity).toBe(2);
  });
});

// Several additional branches (telemetry.perceivedLatency, time-of-day
// system prompt, useConversation interim isFinal transition) are reached
// indirectly by other test files in this suite and are excluded here to
// avoid test-isolation conflicts with the vi.doMock calls above. They
// remain valid coverage targets if moved to their own test file later.

// ---- useVAD: disconnect() when audio nodes throw on disconnect --------

describe("useVAD — disconnect throw branches", () => {
  it("stopListening tolerates source/analyser disconnect() throwing", async () => {
    // @vitest-environment happy-dom
    const happyDom = await import("happy-dom");
    const win = new happyDom.Window();
    vi.stubGlobal("window", win as unknown as Window);
    vi.stubGlobal("document", win.document);

    const throwingSource = {
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        throw new Error("src-already-disconnected");
      }),
    };
    const throwingAnalyser = {
      fftSize: 512,
      smoothingTimeConstant: 0.8,
      frequencyBinCount: 128,
      getByteFrequencyData: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = 0;
      },
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        throw new Error("analyser-already-disconnected");
      }),
    };
    vi.doMock("@/lib/audio", () => ({
      getSharedAudioContext: () => ({
        createMediaStreamSource: () => throwingSource,
        createAnalyser: () => throwingAnalyser,
      }),
      resumeSharedAudioContext: vi.fn(),
    }));

    const { useVAD } = await import("@/hooks/useVAD");
    const { renderHook, act } = await import("@testing-library/react");
    const { result } = renderHook(() => useVAD());
    act(() => {
      result.current.startListening({} as MediaStream);
    });
    expect(() => {
      act(() => {
        result.current.stopListening();
      });
    }).not.toThrow();
  });
});
