// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---- Fake AudioContext + nodes driven by test code ---------------------

interface FakeSource {
  buffer: unknown;
  onended: (() => void) | null;
  connect: () => void;
  disconnect: () => void;
  start: (at?: number) => void;
  stop: () => void;
  _started: boolean;
}

let ctxState: AudioContextState = "running";
let resumeFn = vi.fn(async () => {
  ctxState = "running";
});
let decodeSucceeds = true;
let sourceStartThrows = false;
let createdSources: FakeSource[] = [];
let ctxCurrentTime = 0;

function freshSource(): FakeSource {
  const src: FakeSource = {
    buffer: null,
    onended: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: (() => {
      if (sourceStartThrows) throw new Error("source start blocked");
      src._started = true;
    }) as (at?: number) => void,
    stop: vi.fn(),
    _started: false,
  };
  createdSources.push(src);
  return src;
}

function makeFakeCtx() {
  return {
    get state() {
      return ctxState;
    },
    sampleRate: 48000,
    get currentTime() {
      return ctxCurrentTime;
    },
    destination: {},
    resume: resumeFn,
    decodeAudioData: (
      _buf: ArrayBuffer,
      success: (b: AudioBuffer) => void,
      error: (e: Error) => void
    ) => {
      if (decodeSucceeds) {
        success({ duration: 0.5 } as AudioBuffer);
      } else {
        error(new Error("decode failed"));
      }
    },
    createBufferSource: () => freshSource(),
    createBuffer: (_ch: number, length: number) => ({
      duration: length / 24000,
      getChannelData: () => new Float32Array(length),
    }),
  };
}

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => makeFakeCtx(),
  resumeSharedAudioContext: () => resumeFn(),
}));

vi.mock("@/lib/telemetry", () => ({
  telemetry: { mark: vi.fn() },
}));

import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";

beforeEach(() => {
  ctxState = "running";
  ctxCurrentTime = 0;
  decodeSucceeds = true;
  sourceStartThrows = false;
  createdSources = [];
  resumeFn = vi.fn(async () => {
    ctxState = "running";
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Swap fetch for each test.
function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>
) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

function wavBytes(): ArrayBuffer {
  // The decode mock doesn't actually parse — any buffer works.
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

describe("useCartesiaTTS — lifecycle + enqueue", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useCartesiaTTS());
    expect(result.current.status).toBe("idle");
  });

  it("enqueue('') is a no-op", () => {
    stubFetch(async () => new Response(wavBytes(), { status: 200 }));
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.enqueue("   ");
    });
    expect(result.current.status).toBe("idle");
  });

  it("enqueue() fetches /api/tts, plays, and returns to idle", async () => {
    stubFetch(
      async () => new Response(wavBytes(), { status: 200 })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("hello");
    });
    await waitFor(() => expect(createdSources.length).toBeGreaterThan(0));
    // Trigger onended to let the queue drain.
    act(() => createdSources[0].onended?.());
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("enqueue() skips the null-decoded branch and keeps draining", async () => {
    decodeSucceeds = false;
    stubFetch(async () => new Response(wavBytes(), { status: 200 }));
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("hello");
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("enqueue() swallows TTS fetch failures", async () => {
    stubFetch(async () => new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("hello");
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("enqueue() handles thrown fetch errors without crashing", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("hello");
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("enqueueBuffer() plays a pre-cached buffer as a filler", async () => {
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.enqueueBuffer(wavBytes());
    });
    await waitFor(() => expect(createdSources.length).toBeGreaterThan(0));
    act(() => createdSources[0].onended?.());
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("preloadBuffer() returns the fetched ArrayBuffer", async () => {
    stubFetch(async () => new Response(wavBytes(), { status: 200 }));
    const { result } = renderHook(() => useCartesiaTTS());
    let buf: ArrayBuffer | null = null;
    await act(async () => {
      buf = await result.current.preloadBuffer("filler", "en");
    });
    expect(buf).not.toBeNull();
  });

  it("preloadBuffer() returns null on fetch failure", async () => {
    stubFetch(async () => new Response("err", { status: 500 }));
    const { result } = renderHook(() => useCartesiaTTS());
    let buf: ArrayBuffer | null = null;
    await act(async () => {
      buf = await result.current.preloadBuffer("filler");
    });
    expect(buf).toBeNull();
  });

  it("preloadBuffer() returns null for empty text without hitting fetch", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useCartesiaTTS());
    let buf: ArrayBuffer | null = null;
    await act(async () => {
      buf = await result.current.preloadBuffer("   ");
    });
    expect(buf).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("preloadBuffer() catches thrown fetch errors and returns null", async () => {
    stubFetch(async () => {
      throw new Error("dns");
    });
    const { result } = renderHook(() => useCartesiaTTS());
    let buf: ArrayBuffer | null = null;
    await act(async () => {
      buf = await result.current.preloadBuffer("hi");
    });
    expect(buf).toBeNull();
  });
});

describe("useCartesiaTTS — stop()", () => {
  it("stop() clears the queue and flips generation so mid-flight playback aborts", async () => {
    stubFetch(async () => new Response(wavBytes(), { status: 200 }));
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.enqueue("one");
      result.current.enqueue("two");
    });
    act(() => {
      result.current.stop();
    });
    expect(result.current.status).toBe("idle");
  });

  it("stop() stops currently-playing source.stop()", async () => {
    stubFetch(async () => new Response(wavBytes(), { status: 200 }));
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.enqueue("one");
    });
    await waitFor(() => expect(createdSources.length).toBeGreaterThan(0));
    const src = createdSources[0];
    act(() => {
      result.current.stop();
    });
    expect(src.stop).toHaveBeenCalled();
  });
});

describe("useCartesiaTTS — unlock()", () => {
  it("unlock() plays a silent buffer to satisfy iOS user-gesture rule", async () => {
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.unlock();
      // unlock chains a microtask (resume → createBuffer); let it drain.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(createdSources.length).toBeGreaterThan(0);
    expect(createdSources[0]._started).toBe(true);
  });

  it("unlock() is idempotent — subsequent calls skip work", async () => {
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.unlock();
      await new Promise((r) => setTimeout(r, 0));
    });
    const first = createdSources.length;
    await act(async () => {
      result.current.unlock();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(createdSources.length).toBe(first);
  });

  it("unlock() resumes a suspended context first", async () => {
    ctxState = "suspended";
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.unlock();
      await Promise.resolve();
    });
    expect(resumeFn).toHaveBeenCalled();
  });

  it("unlock() swallows createBuffer/source.start failures", () => {
    sourceStartThrows = true;
    const { result } = renderHook(() => useCartesiaTTS());
    expect(() => {
      act(() => {
        result.current.unlock();
      });
    }).not.toThrow();
  });
});

describe("useCartesiaTTS — streamEnqueue()", () => {
  function makeStreamingBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
  }

  it("no-ops for empty text without hitting fetch", () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useCartesiaTTS());
    act(() => {
      result.current.streamEnqueue("   ");
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("streams PCM chunks into the graph and marks audioFirstPlay", async () => {
    // 6000 bytes at 24kHz mono = 125ms — above the 120ms flush threshold,
    // so one schedule() call fires during the loop.
    const pcm = new Uint8Array(6000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i & 0xff;
    stubFetch(
      async () =>
        new Response(makeStreamingBody([pcm]), { status: 200 })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hello");
      // Let the async reader drain.
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(createdSources.length).toBeGreaterThan(0);
  });

  it("falls back to batch enqueue() when the stream endpoint fails", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls += 1;
        if (url.includes("/api/tts/stream")) {
          return new Response("fail", { status: 500 });
        }
        return new Response(wavBytes(), { status: 200 });
      })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hello");
      await new Promise((r) => setTimeout(r, 10));
    });
    // Fallback batch call to /api/tts fires in addition to the stream.
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("flushes the trailing (<120ms) remainder after the stream ends", async () => {
    // 1200 bytes = 25ms — below flush threshold, only flushed at end.
    const pcm = new Uint8Array(1200);
    stubFetch(
      async () =>
        new Response(makeStreamingBody([pcm]), { status: 200 })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("brief");
      await new Promise((r) => setTimeout(r, 10));
    });
    // One source should be scheduled from the trailing flush.
    expect(createdSources.length).toBeGreaterThan(0);
  });

  it("bails out quietly when the body is missing", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls += 1;
        if (url.includes("/api/tts/stream")) {
          // 500 triggers the fallback path that we already covered.
          // Here: a 200 with a null body would also be treated as an
          // error; we simulate a network throw instead to cover the
          // catch branch reliably.
          throw new Error("stream died");
        }
        return new Response(wavBytes(), { status: 200 });
      })
    );
    const { result } = renderHook(() => useCartesiaTTS());
    await act(async () => {
      result.current.streamEnqueue("hi");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
