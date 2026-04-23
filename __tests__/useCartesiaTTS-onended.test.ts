// @vitest-environment happy-dom
//
// Covers lines 249-258 of useCartesiaTTS — the onended callback on a
// streamed PCM source. That handler removes the source from the
// streamSources set, flips status back to idle, and defensively
// disconnects. Must fire to land all of these lines.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

let latestSource: {
  buffer: unknown;
  onended: (() => void) | null;
  connect: () => void;
  disconnect: () => void;
  start: (at?: number) => void;
  stop: () => void;
} | null = null;

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
      const src = {
        buffer: null,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(() => {
          throw new Error("already disconnected");
        }),
        start: vi.fn(),
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

vi.mock("@/lib/telemetry", () => ({ telemetry: { mark: vi.fn() } }));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  latestSource = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCartesiaTTS — streamed source onended cleanup", () => {
  it("onended removes source, flips to idle, tolerates disconnect throw", async () => {
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
    await act(async () => {
      result.current.streamEnqueue("hello");
      await new Promise((r) => setTimeout(r, 10));
    });
    await waitFor(() => expect(latestSource).not.toBeNull());
    // Fire onended — this is the real Web Audio signal when playback
    // finishes. The inner try/catch around disconnect() must swallow
    // the intentional throw in our mock.
    act(() => {
      latestSource!.onended?.();
    });
    // After the last streamed source ends the hook reports idle.
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});
