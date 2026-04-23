// @vitest-environment happy-dom
//
// Covers `if (!audioContext) return;` at useDeepgram.ts:48 — the guard
// inside startAudioCapture that fires when getSharedAudioContext()
// returns null at the moment ws.onopen fires (iOS suspension edge case).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Toggle ctx availability per-test.
const audio = { available: true };

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => {
    if (!audio.available) return null;
    return {
      sampleRate: 16000,
      createMediaStreamSource: () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createScriptProcessor: () => ({
        onaudioprocess: null as
          | ((e: {
              inputBuffer: { getChannelData: () => Float32Array };
            }) => void)
          | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      destination: {},
    };
  },
}));

vi.mock("@/lib/telemetry", () => ({
  telemetry: { mark: vi.fn() },
}));

interface FakeWS {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: null;
  onerror: null;
  sent: unknown[];
  send: (d: unknown) => void;
  close: () => void;
}
let lastWs: FakeWS | null = null;

class MockWS {
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose = null;
  onerror = null;
  sent: unknown[] = [];
  constructor(url: string) {
    this.url = url;
    lastWs = this as unknown as FakeWS;
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {
    this.readyState = MockWS.CLOSED;
  }
}

import { useDeepgram } from "@/hooks/useDeepgram";

const FAKE_STREAM = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream;

beforeEach(() => {
  audio.available = true;
  lastWs = null;
  vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ key: "k" }), { status: 200 }))
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDeepgram.startAudioCapture — null audio context guard", () => {
  it("bails at line 48 when getSharedAudioContext returns null on open", async () => {
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    // Flip ctx availability off RIGHT before ws.onopen triggers
    // startAudioCapture → it sees null and returns immediately.
    audio.available = false;
    act(() => {
      lastWs!.onopen?.();
    });
    // onopen still set status to "connected" before calling startAudioCapture.
    expect(result.current.status).toBe("connected");
  });
});
