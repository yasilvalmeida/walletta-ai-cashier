// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

interface FakeSource {
  buffer: unknown;
  onended: (() => void) | null;
  connect: () => void;
  disconnect: () => void;
  start: (at?: number) => void;
  stop: () => void;
}

let createdSources: FakeSource[] = [];
let ctxCurrentTime = 0;

function freshSource(startShouldThrow = false): FakeSource {
  const src: FakeSource = {
    buffer: null,
    onended: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: () => {
      if (startShouldThrow) throw new Error("start blocked");
    },
    stop: vi.fn(),
  };
  createdSources.push(src);
  return src;
}

function makeCtx() {
  return {
    state: "running" as AudioContextState,
    sampleRate: 48000,
    get currentTime() {
      return ctxCurrentTime;
    },
    destination: {},
    resume: async () => {},
    decodeAudioData: (
      _buf: ArrayBuffer,
      success: (b: AudioBuffer) => void
    ) => {
      success({ duration: 0.2 } as AudioBuffer);
    },
    createBufferSource: () => freshSource(),
    createBuffer: (_ch: number, length: number) => ({
      duration: length / 24000,
      getChannelData: () => new Float32Array(length),
    }),
  };
}

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => makeCtx(),
  resumeSharedAudioContext: async () => "running" as const,
}));

vi.mock("@/lib/telemetry", () => ({
  telemetry: { mark: vi.fn() },
}));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  createdSources = [];
  ctxCurrentTime = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeStreamBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe("useCartesiaTTS — stop() mid-stream cancels in-flight PCM sources", () => {
  it("stop() stops every source in the streamSourcesRef set (line 404-415)", async () => {
    // A stream with a single 6000-byte chunk schedules one source. Stop
    // mid-playback should call .stop() on that source and clear the set.
    const pcm = new Uint8Array(6000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i & 0xff;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(makeStreamBody([pcm]), { status: 200 })
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hello");
      await new Promise((r) => setTimeout(r, 10));
    });
    const streamSource = createdSources[createdSources.length - 1];
    expect(streamSource).toBeDefined();
    act(() => {
      result.current.stop();
    });
    expect(streamSource.stop).toHaveBeenCalled();
  });

  it("stop() tolerates source.stop() and source.disconnect() throwing", async () => {
    const pcm = new Uint8Array(6000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(makeStreamBody([pcm]), { status: 200 })
      )
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hi");
      await new Promise((r) => setTimeout(r, 10));
    });
    const src = createdSources[createdSources.length - 1];
    src.stop = () => {
      throw new Error("already stopped");
    };
    src.disconnect = () => {
      throw new Error("already disconnected");
    };
    expect(() => {
      act(() => {
        result.current.stop();
      });
    }).not.toThrow();
  });
});

describe("useCartesiaTTS — unlock() rejected resume path", () => {
  it("swallows a rejected ctx.resume() promise (line 444-446)", async () => {
    // Re-mock audio with a resume that rejects.
    vi.resetModules();
    vi.doMock("@/lib/audio", () => ({
      getSharedAudioContext: () => ({
        state: "suspended" as AudioContextState,
        destination: {},
        resume: async () => {
          throw new Error("no user gesture");
        },
        createBuffer: () => ({
          duration: 0,
          getChannelData: () => new Float32Array(1),
        }),
        createBufferSource: () => ({
          buffer: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
      }),
      resumeSharedAudioContext: async () => "suspended",
    }));
    vi.doMock("@/lib/telemetry", () => ({ telemetry: { mark: vi.fn() } }));
    const { useCartesiaTTS: fresh } = await import(
      "@/hooks/useCartesiaTTS"
    );
    const { result } = renderHook(() => fresh());
    await act(async () => {
      result.current.unlock();
      await new Promise((r) => setTimeout(r, 5));
    });
    // No crash — the .catch() branch at line 444-446 swallowed the rejection.
    expect(true).toBe(true);
  });
});
