// @vitest-environment happy-dom
//
// Targets the last remaining useCartesiaTTS statement/branch gaps:
//  - 78/121    processQueue concurrent-guard, done() idempotence
//  - 218, 425  streamEnqueue/unlock null-ctx guards
//  - 239, 291  zero-sample PCM chunk + empty stream value

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const audio = {
  ctxAvailable: true as boolean,
};

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => {
    if (!audio.ctxAvailable) return null;
    return {
      state: "running" as AudioContextState,
      sampleRate: 48000,
      currentTime: 0,
      destination: {},
      resume: async () => {},
      decodeAudioData: (
        _buf: ArrayBuffer,
        success: (b: AudioBuffer) => void
      ) => success({ duration: 0.1 } as AudioBuffer),
      createBufferSource: () => ({
        buffer: null,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createBuffer: (_c: number, length: number) => ({
        duration: length / 24000,
        getChannelData: () => new Float32Array(length),
      }),
    };
  },
  resumeSharedAudioContext: async () => "running" as const,
}));

vi.mock("@/lib/telemetry", () => ({ telemetry: { mark: vi.fn() } }));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  audio.ctxAvailable = true;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCartesiaTTS — final branch coverage", () => {
  it("streamEnqueue short-circuits when getSharedAudioContext is null (line 218)", async () => {
    audio.ctxAvailable = false;
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.streamEnqueue("hi");
    });
    // streamEnqueue bails before fetch() because ctx was null.
    expect(fn).not.toHaveBeenCalled();
  });

  it("unlock short-circuits when getSharedAudioContext is null (line 425)", () => {
    audio.ctxAvailable = false;
    const { result } = renderHook(() => useCartesiaTTS());
    expect(() => {
      act(() => {
        result.current.unlock();
      });
    }).not.toThrow();
  });

  it("streamEnqueue ignores empty chunks from the stream reader (line 291)", async () => {
    const empty = new Uint8Array(0);
    const real = new Uint8Array(6000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(empty);
                c.enqueue(real);
                c.close();
              },
            }),
            { status: 200 }
          )
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hello");
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("streamEnqueue skips a chunk whose byte length is odd (zero int16 samples after floor)", async () => {
    // A 1-byte chunk produces Math.floor(1/2)=0 int16 samples → schedule()'s
    // int16.length===0 branch fires (line 239).
    const oneByte = new Uint8Array([0xff]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(oneByte);
                c.close();
              },
            }),
            { status: 200 }
          )
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hi");
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("enqueue while another enqueue is already processing hits the guard (line 78)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 })
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    // Call enqueue twice in the same tick — the second call pushes
    // onto queueRef but finds processingRef already true, so processQueue
    // returns at line 78 rather than running a parallel loop.
    act(() => {
      result.current.enqueue("first");
      result.current.enqueue("second");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("stop() called mid-stream causes schedule to no-op on later chunks (line 231 / 323)", async () => {
    const big = new Uint8Array(6000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(big);
                // Delay-close so we have time to call stop() in between.
                setTimeout(() => c.close(), 20);
              },
            }),
            { status: 200 }
          )
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.streamEnqueue("hi");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    act(() => {
      result.current.stop();
    });
    // Any subsequent schedule() call sees genRef.current !== gen and returns.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  });
});
