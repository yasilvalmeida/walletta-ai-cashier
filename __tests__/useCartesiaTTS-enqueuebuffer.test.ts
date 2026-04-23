// @vitest-environment happy-dom
//
// Covers useCartesiaTTS.ts:349 — the non-idle arm of the setStatus
// ternary `(prev) => (prev === "idle" ? "loading" : prev)` inside
// enqueueBuffer. First enqueueBuffer transitions idle→loading; a
// second enqueueBuffer while still loading hits the non-idle arm.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => ({
    state: "running" as AudioContextState,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => {},
    decodeAudioData: () => new Promise(() => {}), // never resolves → keeps status=loading
    createBufferSource: () => ({
      buffer: null,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createBuffer: () => ({
      duration: 0,
      getChannelData: () => new Float32Array(0),
    }),
  }),
  resumeSharedAudioContext: async () => "running" as const,
}));

vi.mock("@/lib/telemetry", () => ({ telemetry: { mark: vi.fn() } }));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCartesiaTTS.enqueueBuffer — non-idle setStatus arm (line 349)", () => {
  it("second enqueueBuffer while status is 'loading' returns prev unchanged", async () => {
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.enqueueBuffer(new ArrayBuffer(4));
    });
    // First call: status flipped idle → loading. decodeAudioData never
    // resolves so we stay at loading.
    expect(result.current.status).toBe("loading");
    act(() => {
      result.current.enqueueBuffer(new ArrayBuffer(4));
    });
    // Second call's setStatus sees prev="loading" → returns prev (line 349).
    expect(result.current.status).toBe("loading");
  });
});
