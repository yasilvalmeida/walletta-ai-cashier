// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// --- Shared WebSocket fake so tests can drive onopen/onmessage/onclose ---
interface FakeWS {
  url: string;
  protocols: string[];
  readyState: number;
  onopen: ((ev?: Event) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  sent: unknown[];
  close: () => void;
  send: (data: unknown) => void;
}

let lastWs: FakeWS | null = null;

class MockWebSocket implements FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  url: string;
  protocols: string[];
  readyState = 1;
  onopen: ((ev?: Event) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sent: unknown[] = [];
  constructor(url: string, protocols: string | string[] = []) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : [protocols];
    lastWs = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

// --- Audio graph mock: getSharedAudioContext returns a fake context ---
let latestProcessor: {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null;
  disconnect: () => void;
} | null = null;

vi.mock("@/lib/audio", () => ({
  getSharedAudioContext: () => ({
    sampleRate: 48000,
    createMediaStreamSource: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createScriptProcessor: () => {
      const processor = {
        onaudioprocess: null as ((e: {
          inputBuffer: { getChannelData: () => Float32Array };
        }) => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      latestProcessor = processor;
      return processor;
    },
    destination: {},
  }),
}));

// Silence telemetry — not under test here.
vi.mock("@/lib/telemetry", () => ({
  telemetry: {
    mark: vi.fn(),
    startTurn: vi.fn(),
    endTurn: vi.fn(),
  },
}));

import { useDeepgram } from "@/hooks/useDeepgram";

const FAKE_STREAM = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream;

function mockTokenOnce(body: Record<string, unknown> | Error, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body), { status });
    })
  );
}

beforeEach(() => {
  lastWs = null;
  latestProcessor = null;
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDeepgram — lifecycle", () => {
  it("starts idle", () => {
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    expect(result.current.status).toBe("idle");
  });

  it("fetches the token and opens a WS with the correct URL + subprotocol", async () => {
    mockTokenOnce({ key: "dg-secret" });
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    expect(lastWs).not.toBeNull();
    expect(lastWs!.url).toContain("wss://api.deepgram.com/v1/listen");
    expect(lastWs!.url).toContain("model=nova-3");
    expect(lastWs!.url).toContain("language=multi");
    // Nova-3 requires `keyterm` — regression guard for the Apr 23 fix.
    expect(lastWs!.url).toContain("keyterm=");
    expect(lastWs!.url).not.toContain("keywords=");
    expect(lastWs!.protocols).toEqual(["token", "dg-secret"]);
  });

  it("flips to 'connected' when the WS opens and starts audio capture", async () => {
    mockTokenOnce({ key: "k" });
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    expect(result.current.status).toBe("connected");
    // The audio processor was wired up (onaudioprocess assigned).
    expect(latestProcessor).not.toBeNull();
    expect(typeof latestProcessor!.onaudioprocess).toBe("function");
  });

  it("reports an error when the token fetch returns non-OK", async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503 }))
    );
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn(), onError })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    expect(result.current.status).toBe("error");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/503/);
  });

  it("reports an error when fetch itself throws", async () => {
    const onError = vi.fn();
    mockTokenOnce(new Error("net down"));
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn(), onError })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    expect(result.current.status).toBe("error");
    expect(onError).toHaveBeenCalled();
  });

  it("handles non-Error thrown values in the catch (String fallback)", async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "plain-string-failure";
      })
    );
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn(), onError })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("useDeepgram — transcript delivery", () => {
  async function primed(options: Parameters<typeof useDeepgram>[0]) {
    mockTokenOnce({ key: "k" });
    const r = renderHook(() => useDeepgram(options));
    await act(async () => {
      await r.result.current.connect(FAKE_STREAM);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    return r.result;
  }

  it("emits interim transcripts via onTranscript(isFinal=false)", async () => {
    const onTranscript = vi.fn();
    await primed({ onTranscript, onSpeechEnd: vi.fn() });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: {
            alternatives: [{ transcript: "ma", confidence: 0.9 }],
          },
          is_final: false,
        }),
      });
    });
    expect(onTranscript).toHaveBeenCalledWith("ma", false);
  });

  it("accumulates is_final fragments and calls onSpeechEnd on speech_final", async () => {
    const onTranscript = vi.fn();
    const onSpeechEnd = vi.fn();
    await primed({ onTranscript, onSpeechEnd });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: {
            alternatives: [
              { transcript: "matcha", confidence: 0.9, languages: ["en"] },
            ],
          },
          is_final: true,
        }),
      });
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "please", confidence: 0.9 }] },
          is_final: true,
          speech_final: true,
        }),
      });
    });
    expect(onSpeechEnd).toHaveBeenCalledWith("matcha please", "en");
  });

  it("uses the speech_final fallback timer (1500ms) when speech_final never arrives", async () => {
    const onSpeechEnd = vi.fn();
    await primed({ onTranscript: vi.fn(), onSpeechEnd });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "hello", confidence: 0.9 }] },
          is_final: true,
        }),
      });
    });
    expect(onSpeechEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onSpeechEnd).toHaveBeenCalledWith("hello", undefined);
  });

  it("handles a channel payload with an empty alternatives array (line 159)", async () => {
    const onTranscript = vi.fn();
    const onSpeechEnd = vi.fn();
    await primed({ onTranscript, onSpeechEnd });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [] },
          is_final: false,
        }),
      });
    });
    // alt is undefined → transcript coerces to "" via `?? ""`. No callbacks fire.
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it("handles a speech_final frame when transcriptRef is already empty (line 169)", async () => {
    // flushTranscript is called with transcriptRef.current = "" — the
    // `if (full)` branch is false, so onSpeechEnd must NOT fire.
    const onSpeechEnd = vi.fn();
    await primed({ onTranscript: vi.fn(), onSpeechEnd });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "", confidence: 0 }] },
          is_final: true,
          speech_final: true,
        }),
      });
    });
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it("handles a single-frame utterance arriving with speech_final immediately", async () => {
    // Covers the empty-prefix branch: transcriptRef is empty when the
    // speech_final frame carries the only transcript.
    const onSpeechEnd = vi.fn();
    await primed({ onTranscript: vi.fn(), onSpeechEnd });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: {
            alternatives: [{ transcript: "done", confidence: 0.9 }],
          },
          is_final: true,
          speech_final: true,
        }),
      });
    });
    expect(onSpeechEnd).toHaveBeenCalledWith("done", undefined);
  });

  it("appends interim with a leading space when transcriptRef already has text (line 212 truthy arm)", async () => {
    const onTranscript = vi.fn();
    await primed({ onTranscript, onSpeechEnd: vi.fn() });
    // First is_final populates transcriptRef.
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "hello", confidence: 0.9 }] },
          is_final: true,
        }),
      });
    });
    onTranscript.mockClear();
    // Next interim — transcriptRef is non-empty, so the ternary's
    // truthy arm runs: `transcriptRef.current + " " + transcript`.
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "world", confidence: 0.9 }] },
          is_final: false,
        }),
      });
    });
    expect(onTranscript).toHaveBeenCalledWith("hello world", false);
  });

  it("delivers the first-word interim transcript with no leading space", async () => {
    // Covers the ternary branch where transcriptRef is empty on the
    // first interim arrival.
    const onTranscript = vi.fn();
    await primed({ onTranscript, onSpeechEnd: vi.fn() });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "hello", confidence: 0.9 }] },
          is_final: false,
        }),
      });
    });
    expect(onTranscript).toHaveBeenCalledWith("hello", false);
  });

  it("ignores messages with no channel.alternatives (metadata frames)", async () => {
    const onTranscript = vi.fn();
    await primed({ onTranscript, onSpeechEnd: vi.fn() });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({ type: "Metadata", request_id: "abc" }),
      });
    });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("swallows non-JSON message payloads", async () => {
    const onTranscript = vi.fn();
    await primed({ onTranscript, onSpeechEnd: vi.fn() });
    act(() => {
      lastWs!.onmessage?.({ data: "not json" });
    });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("handles speech_final frames with empty transcripts (endpoint-only event)", async () => {
    const onSpeechEnd = vi.fn();
    await primed({ onTranscript: vi.fn(), onSpeechEnd });
    // First a real is_final so transcriptRef has content.
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "hi", confidence: 0.9 }] },
          is_final: true,
        }),
      });
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "", confidence: 0 }] },
          is_final: true,
          speech_final: true,
        }),
      });
    });
    expect(onSpeechEnd).toHaveBeenCalledWith("hi", undefined);
  });

  it("drops interim frames that contain no transcript text", async () => {
    const onTranscript = vi.fn();
    await primed({ onTranscript, onSpeechEnd: vi.fn() });
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "", confidence: 0 }] },
          is_final: false,
        }),
      });
    });
    expect(onTranscript).not.toHaveBeenCalled();
  });
});

describe("useDeepgram — audio capture + PCM send", () => {
  it("resamples 48kHz input to 16kHz int16 and sends over the WS", async () => {
    mockTokenOnce({ key: "k" });
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    // Feed 4096 samples of full-scale float input — the processor runs
    // at 48 kHz, we resample to 16 kHz → ~1365 samples of int16 = 2730 bytes.
    const input = new Float32Array(4096);
    for (let i = 0; i < input.length; i++) input[i] = 1;
    act(() => {
      latestProcessor!.onaudioprocess!({
        inputBuffer: { getChannelData: () => input },
      });
    });
    expect(lastWs!.sent).toHaveLength(1);
    const buf = lastWs!.sent[0] as ArrayBuffer;
    const view = new Int16Array(buf);
    expect(view.length).toBe(Math.round(4096 / 3)); // 48k → 16k ratio = 3
    expect(view[0]).toBe(0x7fff); // full-scale positive
  });

  it("skips the pass-through branch when nativeSampleRate already equals 16kHz", async () => {
    // Re-mock audio to return a 16kHz context for this test only.
    vi.doMock("@/lib/audio", () => ({
      getSharedAudioContext: () => ({
        sampleRate: 16000,
        createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
        createScriptProcessor: () => {
          const processor = {
            onaudioprocess: null as
              | ((e: {
                  inputBuffer: { getChannelData: () => Float32Array };
                }) => void)
              | null,
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
          latestProcessor = processor;
          return processor;
        },
        destination: {},
      }),
    }));
    vi.resetModules();
    const { useDeepgram: freshUseDeepgram } = await import(
      "@/hooks/useDeepgram"
    );
    mockTokenOnce({ key: "k" });
    const { result } = renderHook(() =>
      freshUseDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    const input = new Float32Array(4096);
    input[0] = -1;
    act(() => {
      latestProcessor!.onaudioprocess!({
        inputBuffer: { getChannelData: () => input },
      });
    });
    const buf = lastWs!.sent[0] as ArrayBuffer;
    const view = new Int16Array(buf);
    // Same length as input — no resampling.
    expect(view.length).toBe(4096);
    // Full-scale negative maps to -0x8000.
    expect(view[0]).toBe(-0x8000);
  });

  it("no-ops audio processing when the WS is not OPEN", async () => {
    mockTokenOnce({ key: "k" });
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    // Close the WS, then drive the processor — no frames should be sent.
    lastWs!.readyState = MockWebSocket.CLOSED;
    act(() => {
      latestProcessor!.onaudioprocess!({
        inputBuffer: { getChannelData: () => new Float32Array(4096) },
      });
    });
    expect(lastWs!.sent).toHaveLength(0);
  });
});

describe("useDeepgram — close semantics", () => {
  async function primed(options: Parameters<typeof useDeepgram>[0]) {
    mockTokenOnce({ key: "k" });
    const r = renderHook(() => useDeepgram(options));
    await act(async () => {
      await r.result.current.connect(FAKE_STREAM);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    return r.result;
  }

  it("treats 1000 as a clean close and returns to idle", async () => {
    const onError = vi.fn();
    const result = await primed({
      onTranscript: vi.fn(),
      onSpeechEnd: vi.fn(),
      onError,
    });
    act(() => {
      lastWs!.onclose?.({
        code: 1000,
        reason: "",
        wasClean: true,
      } as CloseEvent);
    });
    expect(result.current.status).toBe("idle");
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces a 1006 abnormal close as onError and status=error", async () => {
    const onError = vi.fn();
    const result = await primed({
      onTranscript: vi.fn(),
      onSpeechEnd: vi.fn(),
      onError,
    });
    act(() => {
      lastWs!.onclose?.({
        code: 1006,
        reason: "",
        wasClean: false,
      } as CloseEvent);
    });
    expect(result.current.status).toBe("error");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/1006/);
  });

  it("includes the reason string in the error when Deepgram provides one", async () => {
    const onError = vi.fn();
    await primed({
      onTranscript: vi.fn(),
      onSpeechEnd: vi.fn(),
      onError,
    });
    act(() => {
      lastWs!.onclose?.({
        code: 4001,
        reason: "Authentication failed",
        wasClean: true,
      } as CloseEvent);
    });
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/4001/);
    expect((onError.mock.calls[0][0] as Error).message).toMatch(
      /Authentication failed/
    );
  });

  it("only reports the error once even if close fires twice", async () => {
    const onError = vi.fn();
    await primed({
      onTranscript: vi.fn(),
      onSpeechEnd: vi.fn(),
      onError,
    });
    act(() => {
      lastWs!.onclose?.({ code: 1006, reason: "", wasClean: false } as CloseEvent);
      lastWs!.onclose?.({ code: 1006, reason: "", wasClean: false } as CloseEvent);
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("onerror handler logs at debug level but does not surface to onError", async () => {
    const onError = vi.fn();
    await primed({
      onTranscript: vi.fn(),
      onSpeechEnd: vi.fn(),
      onError,
    });
    act(() => {
      lastWs!.onerror?.(new Event("error"));
    });
    // onerror alone should NOT report — only onclose does.
    expect(onError).not.toHaveBeenCalled();
  });

  it("disconnect() closes the WS, stops tracks, and resets to idle", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    mockTokenOnce({ key: "k" });
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(stream);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    const ws = lastWs!;
    act(() => {
      result.current.disconnect();
    });
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
  });

  it("disconnect() is safe before connect() (all refs null)", () => {
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    expect(() => {
      act(() => {
        result.current.disconnect();
      });
    }).not.toThrow();
    expect(result.current.status).toBe("idle");
  });

  it("disconnect() tolerates processor and source .disconnect() throwing", async () => {
    mockTokenOnce({ key: "k" });
    const { result } = renderHook(() =>
      useDeepgram({ onTranscript: vi.fn(), onSpeechEnd: vi.fn() })
    );
    await act(async () => {
      await result.current.connect(FAKE_STREAM);
    });
    act(() => {
      lastWs!.onopen?.();
    });
    // Replace the captured processor's disconnect with a thrower.
    latestProcessor!.disconnect = () => {
      throw new Error("already disconnected");
    };
    expect(() => {
      act(() => {
        result.current.disconnect();
      });
    }).not.toThrow();
  });

  it("disconnect() clears the pending speech_final fallback timer", async () => {
    const onSpeechEnd = vi.fn();
    const result = await primed({
      onTranscript: vi.fn(),
      onSpeechEnd,
    });
    // Queue up a pending 1500ms timer.
    act(() => {
      lastWs!.onmessage?.({
        data: JSON.stringify({
          channel: { alternatives: [{ transcript: "hi", confidence: 0.9 }] },
          is_final: true,
        }),
      });
    });
    act(() => {
      result.current.disconnect();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Timer was cleared, so no speech-end delivered after disconnect.
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });
});
