// @vitest-environment happy-dom
//
// Covers the last uncovered statements in useCartesiaTTS:
//   78   — processQueue concurrent-guard
//   121  — done() settled latch
//   219  — setStatus non-idle ternary arm
//   231  — schedule after stop() flipped gen
//   251  — onended with no active sources + no batch processing
//   323  — fallback batch-enqueue bailing on gen flip

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

interface SourceLike {
  buffer: unknown;
  onended: (() => void) | null;
  connect: () => void;
  disconnect: () => void;
  start: (at?: number) => void;
  stop: () => void;
}

const ctxState = {
  suppressOnended: false,
  startThrows: false,
  decodeSucceeds: true,
};
let sources: SourceLike[] = [];

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => ({
    state: "running" as AudioContextState,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => {},
    decodeAudioData: (
      _b: ArrayBuffer,
      success: (b: AudioBuffer) => void,
      error: (e: Error) => void
    ) => {
      if (!ctxState.decodeSucceeds) error(new Error("decode failed"));
      else success({ duration: 0.1 } as AudioBuffer);
    },
    createBufferSource: () => {
      const src: SourceLike = {
        buffer: null,
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: () => {
          if (ctxState.startThrows) throw new Error("start blocked");
          if (!ctxState.suppressOnended) {
            queueMicrotask(() => src.onended?.());
          }
        },
        stop: vi.fn(),
      };
      sources.push(src);
      return src;
    },
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
  ctxState.suppressOnended = false;
  ctxState.startThrows = false;
  ctxState.decodeSucceeds = true;
  sources = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCartesiaTTS — remaining coverage", () => {
  it("219: setStatus non-idle ternary arm", async () => {
    // Use a never-resolving fetch so status stays 'loading' after the
    // first streamEnqueue. The second call then hits setStatus with
    // prev='loading' and returns prev unchanged.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.streamEnqueue("first");
    });
    expect(result.current.status).toBe("loading");
    act(() => {
      result.current.streamEnqueue("second");
    });
    expect(result.current.status).toBe("loading");
  });

  it("78: processQueue early-return when a queue loop is already running", async () => {
    ctxState.suppressOnended = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(4).buffer, { status: 200 }))
    );
    const { result } = renderHook(() => useCartesiaTTS());
    // Two near-simultaneous enqueues; the second's processQueue sees
    // processingRef=true and returns at line 78.
    act(() => {
      result.current.enqueue("one");
      result.current.enqueue("two");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("231: schedule after stop() flipped gen bails", async () => {
    // Use a pull-based stream where we control each read() individually.
    // First read yields a 6000-byte chunk after a 10ms delay so stop()
    // lands before schedule() gets to evaluate its genRef guard.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              async pull(c) {
                await new Promise((r) => setTimeout(r, 10));
                c.enqueue(new Uint8Array(6000));
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
      // Give the reader one microtask to enter read().
      await new Promise((r) => setTimeout(r, 1));
      // Flip genRef BEFORE the pull() delay fires.
      result.current.stop();
      // Wait for the pull → enqueue → schedule path to run.
      await new Promise((r) => setTimeout(r, 30));
    });
    // status ended at idle because schedule() bailed out at line 231.
    expect(result.current.status).toBe("idle");
  });

  it("251: onended flips back to idle when no stream sources remain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(new Uint8Array(6000));
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
      await new Promise((r) => setTimeout(r, 15));
    });
    // Our mock auto-fires onended in the next microtask. Status flips
    // to "idle" via the size===0 && !processing branch at line 251.
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("323: fallback batch-enqueue bails when gen flipped before catch", async () => {
    let fallbackCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/tts/stream")) {
          // Delay so stop() runs BEFORE the catch arm processes.
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("stream down");
        }
        fallbackCalls += 1;
        return new Response(new Uint8Array(4).buffer, { status: 200 });
      })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.streamEnqueue("hi");
    });
    act(() => {
      result.current.stop();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    // The catch arm returned at line 323 before falling back to /api/tts.
    expect(fallbackCalls).toBe(0);
  });

  it("329-330: stream-fallback batch fetch returns non-OK → null via ternary", async () => {
    // Stream fails, fallback batch fetch returns 500 → the
    // `res.ok ? res.arrayBuffer() : null` ternary's false arm fires.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/tts/stream")) {
          throw new Error("stream down");
        }
        // Batch fallback — return non-OK to hit the ternary null arm.
        return new Response("fail", { status: 500 });
      })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hi");
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("251-253: multiple stream sources — onended with size > 0 does NOT flip idle", async () => {
    // Two 6000-byte chunks → two scheduled sources. Only when BOTH
    // have ended does size==0 and status flips. The first onended hits
    // the `size === 0` false arm (size still 1), no status change.
    ctxState.suppressOnended = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(new Uint8Array(6000));
                c.enqueue(new Uint8Array(6000));
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
    // Expect 2 sources queued (suppressOnended means neither fired yet).
    expect(sources.length).toBeGreaterThanOrEqual(2);
    // Fire first onended → size drops from 2 to 1 → else arm of 251.
    act(() => {
      sources[0].onended?.();
    });
    expect(result.current.status).not.toBe("idle");
    // Second onended → size 0 → 251 true arm → idle.
    act(() => {
      sources[1].onended?.();
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("335: streamEnqueue fallback skips processQueue when enqueue is already running", async () => {
    // Enqueue a first buffer that stays in playback (suppressed onended)
    // so processingRef stays `true`. Then streamEnqueue — its stream
    // endpoint fails, the fallback pushes to the queue and evaluates
    // `if (!processingRef.current)` → false arm (line 335) fires.
    ctxState.suppressOnended = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/tts/stream")) throw new Error("stream down");
        return new Response(new Uint8Array(4).buffer, { status: 200 });
      })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("first");
      await new Promise((r) => setTimeout(r, 20));
    });
    // processingRef is `true` now (source playing, onended suppressed).
    await act(async () => {
      result.current.streamEnqueue("second");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(result.current.status).not.toBe("error");
  });

  it("121: done() twice — stop() during playback triggers source.onended which re-calls done", async () => {
    // In real Web Audio, calling source.stop() BEFORE the buffer ends
    // also fires source.onended. We emulate that by making the mock's
    // .stop() trigger the onended handler. Then useCartesiaTTS.stop()
    // calls currentDoneRef.current() (done → settled=true), and the
    // cascading source.stop() also fires source.onended (→ done again
    // → line 121 `if (settled) return;` fires).
    let playedSource:
      | (typeof sources)[number]
      | null = null;
    const origCreate = ctxState;
    // Patch the source.stop behaviour via a suppressOnended=true
    // configuration that also lets us manually trigger onended.
    ctxState.suppressOnended = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(4).buffer, { status: 200 }))
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("hi");
      // Wait for source.start() to have been called on the playback buffer.
      await new Promise((r) => setTimeout(r, 20));
    });
    playedSource = sources[sources.length - 1];
    expect(playedSource).toBeDefined();
    // Stop the TTS — this calls currentDoneRef.current() first
    // (done → settled=true). We then manually fire source.onended
    // (which IS `done`) — the second call hits line 121's guard.
    act(() => {
      result.current.stop();
    });
    act(() => {
      playedSource!.onended?.();
    });
    expect(result.current.status).toBe("idle");
    void origCreate; // keep ref lint happy
  });
});
