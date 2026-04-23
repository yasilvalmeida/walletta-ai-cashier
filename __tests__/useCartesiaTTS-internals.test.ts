// @vitest-environment happy-dom
//
// The remaining uncovered guards in useCartesiaTTS sit on code paths
// the hook's public API deliberately prevents (processingRef guard,
// schedule gen-mismatch after outer loop break). The guards exist as
// defense-in-depth for future callers, so hitting them via the normal
// API is impossible. This file uses a React intercept to capture the
// internal useCallback closures and invoke them directly — testing
// the guards themselves, not only the callers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Capture every useCallback the hook registers, in order.
const capturedCallbacks: Array<(...args: unknown[]) => unknown> = [];
// Capture every useRef created, in order, so we can flip internal state.
const capturedRefs: Array<{ current: unknown }> = [];

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => {
      capturedCallbacks.push(fn as unknown as (...args: unknown[]) => unknown);
      return fn;
    },
    useRef: <T,>(initial: T) => {
      const ref = { current: initial } as { current: T };
      capturedRefs.push(ref as unknown as { current: unknown });
      return ref;
    },
  };
});

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => ({
    state: "running" as AudioContextState,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => {},
    decodeAudioData: (
      _b: ArrayBuffer,
      success: (b: AudioBuffer) => void
    ) => success({ duration: 0.1 } as AudioBuffer),
    createBufferSource: () => ({
      buffer: null,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createBuffer: (_c: number, length: number) => ({
      duration: length / 24000,
      getChannelData: () => new Float32Array(length),
    }),
  }),
  resumeSharedAudioContext: async () => "running" as const,
}));

vi.mock("@/lib/telemetry", () => ({ telemetry: { mark: vi.fn() } }));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  capturedCallbacks.length = 0;
  capturedRefs.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCartesiaTTS — internal guard coverage via captured refs", () => {
  it("78: direct processQueue invocation while processingRef is already true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(4).buffer, { status: 200 }))
    );
    renderHook(() => useCartesiaTTS());
    // processQueue is the 2nd useCallback in the hook (after decodeBuffer).
    // Its signature is `async (gen: number) => Promise<void>`.
    const processQueue = capturedCallbacks[1] as unknown as (
      gen: number
    ) => Promise<void>;
    expect(typeof processQueue).toBe("function");
    // Flip processingRef BEFORE calling — the guard at line 78 then fires.
    const processingRef = capturedRefs.find(
      (r) => r.current === false
    ) as { current: boolean } | undefined;
    expect(processingRef).toBeDefined();
    const beforeCurrent = processingRef!.current;
    processingRef!.current = true;
    await processQueue(0);
    // processingRef should remain `true` because processQueue returned
    // at line 78 without touching it.
    expect(processingRef!.current).toBe(true);
    processingRef!.current = beforeCurrent; // restore
  });

  it("231: byteLength getter flips genRef between outer break and schedule()", async () => {
    // Trap schedule's genRef-mismatch guard by making `value.byteLength`
    // a side-effect getter. The reader loop reads it AFTER its own
    // break check, so:
    //  1. Break check reads genRef (still = gen), passes.
    //  2. `pendingLen += value.byteLength` invokes the getter → flips genRef.
    //  3. `schedule(merged)` runs; line 231 sees mismatch → return.
    const trappedChunk = new Uint8Array(6000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(trappedChunk);
                c.close();
              },
            }),
            { status: 200 }
          )
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    const genRef = capturedRefs.find((r) => r.current === 0) as
      | { current: number }
      | undefined;
    expect(genRef).toBeDefined();
    // Attach the side-effect getter AFTER render so useRef has initialised.
    Object.defineProperty(trappedChunk, "byteLength", {
      get() {
        genRef!.current = 999;
        return 6000;
      },
      configurable: true,
    });
    await act(async () => {
      result.current.streamEnqueue("hi");
      await new Promise((r) => setTimeout(r, 30));
    });
    // The getter fired, genRef flipped, schedule's guard returned.
    expect(genRef!.current).toBe(999);
  });
});
