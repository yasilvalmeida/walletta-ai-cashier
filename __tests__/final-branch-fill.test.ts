// @vitest-environment happy-dom
//
// Final branch coverage sweep — picks off the last handful of ternary
// fallback arms and defensive guards that required isolated setups.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---- useConversation: getUserMedia throws non-Error (line 456 fallback) ----

describe("useConversation.start — non-Error mic rejection", () => {
  it("falls back to 'Microphone access denied' when getUserMedia throws a non-Error", async () => {
    vi.doMock("@/hooks/useDeepgram", () => ({
      useDeepgram: () => ({
        status: "idle",
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
    }));
    vi.doMock("@/hooks/useVAD", () => ({
      useVAD: () => ({
        isListening: false,
        isSpeaking: false,
        volume: 0,
        startListening: vi.fn(),
        stopListening: vi.fn(),
      }),
    }));
    vi.doMock("@/hooks/useCartesiaTTS", () => ({
      useCartesiaTTS: () => ({
        status: "idle",
        enqueue: vi.fn(),
        streamEnqueue: vi.fn(),
        enqueueBuffer: vi.fn(),
        preloadBuffer: vi.fn(async () => null),
        stop: vi.fn(),
        unlock: vi.fn(),
      }),
    }));
    vi.doMock("@/lib/fillers", () => ({
      fillersFor: () => [],
      pickFiller: () => "",
    }));
    vi.doMock("@/lib/telemetry", () => ({
      telemetry: { mark: vi.fn(), setMode: vi.fn(), endTurn: vi.fn() },
    }));
    vi.doMock("@/lib/tavusPresence", () => ({
      isAvatarSpeaking: () => false,
    }));
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "bare-string-rejection";
        },
      },
      configurable: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { useConversation } = await import("@/hooks/useConversation");
    const { result } = renderHook(() => useConversation());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error).toBe("Microphone access denied");
    expect(result.current.phase).toBe("error");
  });
});

// ---- tts/stream: WebSocket constructor throws → safeClose with ws=null ----

describe("/api/tts/stream — safeClose when ws constructor threw (line 93 ws==null)", () => {
  it("handles the null-ws branch of safeClose's readyState check", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "ck");
    class ExplodingWS {
      constructor() {
        throw new Error("ws boom");
      }
    }
    vi.stubGlobal("WebSocket", ExplodingWS as unknown as typeof WebSocket);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/tts/stream/route");
    const res = await POST(
      new Request("http://localhost/api/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      })
    );
    // After constructor throw: controller.error + safeClose. ws was
    // never assigned so the `ws && ws.readyState <= OPEN` branch at
    // line 93 evaluates to false.
    await expect(res.body!.getReader().read()).rejects.toThrow(/boom/);
  });
});

// (telemetry auto-start is already covered by the stand-alone
// telemetry-extra.test.ts suite.)

// ---- useCartesiaTTS: stop() without any active source or queue ----

describe("useCartesiaTTS.stop — cold call", () => {
  it("is safe to call stop() before any enqueue ever ran", async () => {
    vi.doMock("@/lib/audio", () => ({
      getSharedAudioContext: () => ({
        state: "running" as AudioContextState,
        sampleRate: 48000,
        currentTime: 0,
        destination: {},
        decodeAudioData: (
          _b: ArrayBuffer,
          success: (b: AudioBuffer) => void
        ) => success({ duration: 0 } as AudioBuffer),
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
    vi.doMock("@/lib/telemetry", () => ({ telemetry: { mark: vi.fn() } }));
    const { useCartesiaTTS } = await import("@/hooks/useCartesiaTTS");
    const { result } = renderHook(() => useCartesiaTTS());
    expect(() => {
      act(() => {
        result.current.stop();
      });
    }).not.toThrow();
  });
});
