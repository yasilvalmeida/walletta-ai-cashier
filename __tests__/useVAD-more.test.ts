// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let currentVolume = 0;

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => ({
    createMediaStreamSource: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createAnalyser: () => ({
      fftSize: 512,
      smoothingTimeConstant: 0.8,
      frequencyBinCount: 128,
      getByteFrequencyData: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = currentVolume;
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  }),
  resumeSharedAudioContext: vi.fn(async () => "running"),
}));

import { useVAD } from "@/hooks/useVAD";

beforeEach(() => {
  vi.useFakeTimers();
  currentVolume = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useVAD — stopListening clears a pending silence timer", () => {
  it("stopListening while a silence timer is armed clears it (line 92-93)", () => {
    const onSpeechEnd = vi.fn();
    const { result } = renderHook(() => useVAD({ onSpeechEnd }));
    act(() => {
      result.current.startListening({} as MediaStream);
    });
    // Drive a speech → silence transition to arm the 1500ms timer.
    currentVolume = 40;
    act(() => vi.advanceTimersByTime(100));
    currentVolume = 0;
    act(() => vi.advanceTimersByTime(100));
    // Stop with the timer still pending — the clearTimeout branch fires.
    act(() => {
      result.current.stopListening();
    });
    act(() => vi.advanceTimersByTime(2000));
    // Timer was cleared by stopListening, so onSpeechEnd never fires.
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });
});
