// @vitest-environment happy-dom
//
// Covers line 264-265 of useCartesiaTTS — the catch that fires when
// AudioBufferSourceNode.start() throws while scheduling a streamed
// PCM chunk.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let latestSource: {
  buffer: unknown;
  onended: (() => void) | null;
  connect: () => void;
  disconnect: () => void;
  start: (at?: number) => void;
  stop: () => void;
} | null = null;

let nextStartThrows = false;

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => ({
    state: "running" as AudioContextState,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => {},
    decodeAudioData: (
      _buf: ArrayBuffer,
      success: (b: AudioBuffer) => void
    ) => success({ duration: 0.1 } as AudioBuffer),
    createBufferSource: () => {
      const shouldThrow = nextStartThrows;
      const src = {
        buffer: null,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: () => {
          if (shouldThrow) throw new Error("start blocked");
        },
        stop: vi.fn(),
      };
      latestSource = src;
      return src;
    },
    createBuffer: (_c: number, length: number) => ({
      duration: length / 24000,
      getChannelData: () => new Float32Array(length),
    }),
  }),
  resumeSharedAudioContext: async () => "running" as const,
}));

vi.mock("@/lib/telemetry", () => ({
  telemetry: { mark: vi.fn() },
}));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  latestSource = null;
  nextStartThrows = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCartesiaTTS — streamEnqueue src.start throws", () => {
  it("swallows the start failure and continues (line 264-265)", async () => {
    nextStartThrows = true;
    const pcm = new Uint8Array(6000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(pcm);
                c.close();
              },
            }),
            { status: 200 }
          )
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    // No throw propagates out of streamEnqueue even though the first
    // source.start() call threw — the hook's try/catch at
    // useCartesiaTTS.ts:261-265 absorbed it.
    await act(async () => {
      result.current.streamEnqueue("hello");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(latestSource).not.toBeNull();
  });
});
