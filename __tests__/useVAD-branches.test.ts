// @vitest-environment happy-dom
//
// Covers useVAD defensive branches:
//  - 41: startListening no-ops when audio context is unavailable
//  - 87-105: stopListening when never started (no intervalRef to clear,
//    no sources to disconnect)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let contextAvailable = true;

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => {
    if (!contextAvailable) return null;
    return {
      createMediaStreamSource: () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createAnalyser: () => ({
        fftSize: 512,
        smoothingTimeConstant: 0.8,
        frequencyBinCount: 128,
        getByteFrequencyData: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i++) arr[i] = 0;
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
    };
  },
  resumeSharedAudioContext: vi.fn(async () => "running"),
}));

import { useVAD } from "@/hooks/useVAD";

beforeEach(() => {
  contextAvailable = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useVAD — defensive branches", () => {
  it("startListening is a no-op when the shared AudioContext is null", () => {
    contextAvailable = false;
    const { result } = renderHook(() => useVAD());
    act(() => {
      result.current.startListening({} as MediaStream);
    });
    // isListening stays false because we never got past the ctx guard.
    expect(result.current.isListening).toBe(false);
  });

  it("stopListening is safe to call without prior startListening", () => {
    const { result } = renderHook(() => useVAD());
    expect(() => {
      act(() => {
        result.current.stopListening();
      });
    }).not.toThrow();
    expect(result.current.isListening).toBe(false);
  });
});
