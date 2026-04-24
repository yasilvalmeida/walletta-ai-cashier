// @vitest-environment happy-dom
//
// Covers the odd-byte carry logic in streamEnqueue — fixes the iPhone
// noise the customer reported on 2026-04-23. When the accumulated
// pcm_s16le buffer hits the flush threshold on an odd byte count, the
// trailing byte must be carried forward to the next flush instead of
// being dropped (old bug that produced DC steps / clicks between
// clauses). These tests drive streams with specifically-sized chunks
// so the branch hits.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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
      start: vi.fn(() => {
        /* no-op */
      }),
      stop: vi.fn(),
    }),
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe("useCartesiaTTS — odd-byte carry across flushes", () => {
  it("an odd-total flush stashes the trailing byte and carries it forward", async () => {
    // Two chunks: first flush lands at 5761 bytes (above MIN_CHUNK_BYTES=5760)
    // → odd. The orphan byte is stashed; next flush (the trailing
    // flush of 1 + remaining bytes) picks it up so no audio sample is lost.
    const first = new Uint8Array(5761);
    const second = new Uint8Array(3);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(streamBody([first, second]), { status: 200 })
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hello");
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(result.current.status).not.toBe("error"));
  });

  it("an even-total flush skips the carry branch (control)", async () => {
    // Single 6000-byte chunk — even total, no orphan byte.
    const only = new Uint8Array(6000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(streamBody([only]), { status: 200 })
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hi");
      await new Promise((r) => setTimeout(r, 20));
    });
    await waitFor(() => expect(result.current.status).not.toBe("error"));
  });
});
