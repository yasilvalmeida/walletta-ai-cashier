// @vitest-environment happy-dom
//
// Final coverage-fill for useCartesiaTTS — exercises the 5 remaining
// defensive branches:
//   69-70   decodeAudioData throws synchronously
//   83-84   processQueue short-circuits when ctx is null
//   150-151 source.start() throws during batch enqueue playback
//   159-161 safety timeout fires when onended never does
//   330     stream fallback fetch rejects after stream itself failed

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// --- Per-test mutable context factory so we can swap behaviour ---

interface SourceLike {
  buffer: unknown;
  onended: (() => void) | null;
  connect: () => void;
  disconnect: () => void;
  start: (at?: number) => void;
  stop: () => void;
}

const contextState = {
  available: true as boolean,
  decodeThrows: false as boolean,
  startThrows: false as boolean,
  suppressOnended: false as boolean,
};
let createdSources: SourceLike[] = [];

function buildCtx(): unknown {
  if (!contextState.available) return null;
  return {
    state: "running" as AudioContextState,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => {},
    decodeAudioData: (
      _buf: ArrayBuffer,
      success: (b: AudioBuffer) => void
    ) => {
      if (contextState.decodeThrows) throw new Error("decode threw sync");
      success({ duration: 0.1 } as AudioBuffer);
    },
    createBufferSource: () => {
      const src: SourceLike = {
        buffer: null,
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: () => {
          if (contextState.startThrows) throw new Error("start blocked");
          if (!contextState.suppressOnended) {
            // Fire onended on next microtask so the queue drains.
            queueMicrotask(() => src.onended?.());
          }
        },
        stop: vi.fn(),
      };
      createdSources.push(src);
      return src;
    },
    createBuffer: (_c: number, length: number) => ({
      duration: length / 24000,
      getChannelData: () => new Float32Array(length),
    }),
  };
}

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => buildCtx(),
  resumeSharedAudioContext: async () => "running" as const,
}));

vi.mock("@/lib/telemetry", () => ({ telemetry: { mark: vi.fn() } }));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  contextState.available = true;
  contextState.decodeThrows = false;
  contextState.startThrows = false;
  contextState.suppressOnended = false;
  createdSources = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function wav(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

describe("useCartesiaTTS — defensive branches", () => {
  it("69-70: decodeAudioData throwing synchronously resolves null and drains", async () => {
    contextState.decodeThrows = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wav(), { status: 200 }))
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("hi");
      await new Promise((r) => setTimeout(r, 10));
    });
    // No source should have been created because decode failed.
    expect(createdSources).toHaveLength(0);
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("150-151: batch enqueue source.start throws → done fires and queue drains", async () => {
    contextState.startThrows = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wav(), { status: 200 }))
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("hi");
      await new Promise((r) => setTimeout(r, 10));
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it(
    "159-161: safety timeout forces done() when onended never fires",
    async () => {
      // Real timers + a real ~1.6s wait. Duration=0.1s → safetyMs = 1600.
      contextState.suppressOnended = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(wav(), { status: 200 }))
      );
      const { result } = renderHook(() => useCartesiaTTS());
      await act(async () => {
        result.current.enqueue("hi");
      });
      // Wait just past the safety threshold — 0.1s buffer duration + 1.5s
      // safety = 1600ms; add margin for setImmediate scheduling.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1800));
      });
      expect(result.current.status).toBe("idle");
    },
    5000
  );

  it("83-84: processQueue short-circuits when getSharedAudioContext returns null", async () => {
    // Disable the ctx AFTER the hook mounts so enqueue() schedules
    // processQueue with a null context — lands on the early-return.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wav(), { status: 200 }))
    );
    const { result } = renderHook(() => useCartesiaTTS());
    contextState.available = false;
    await act(async () => {
      result.current.enqueue("hi");
      await new Promise((r) => setTimeout(r, 10));
    });
    // No source built and no throw — the function returned at the
    // (!ctx) branch.
    expect(createdSources).toHaveLength(0);
  });

  it("330: stream fails then fallback fetch also rejects → queue clears without throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/tts/stream")) {
          return new Response("fail", { status: 500 });
        }
        // Fallback path: reject so the .catch(() => null) branch fires.
        throw new Error("fallback failed too");
      })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hello");
      await new Promise((r) => setTimeout(r, 10));
    });
    // No throw propagated; status settles back to idle eventually.
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});
