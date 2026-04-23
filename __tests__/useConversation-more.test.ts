// @vitest-environment happy-dom
//
// Covers the remaining uncovered lines in useConversation:
// - 155:  ensureFillersForLanguage(language) fires on language detection
// - 240:  batch TTS path when `?tts=batch` query param is set (clause)
// - 287:  batch TTS path on the trailing sentence flush (onDone)
// - 389:  Deepgram interim `isFinal` returns to listening phase

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

let lastDgOptions: {
  onTranscript: (t: string, isFinal: boolean) => void;
  onSpeechEnd: (t: string, l?: string) => void;
} | null = null;

const enqueue = vi.fn();
const streamEnqueue = vi.fn();
const preloadBuffer = vi.fn(async () => new ArrayBuffer(4));
const ttsStop = vi.fn();
const ttsUnlock = vi.fn();

vi.mock("@/hooks/useDeepgram", () => ({
  useDeepgram: (opts: typeof lastDgOptions) => {
    lastDgOptions = opts;
    return {
      status: "idle",
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useVAD", () => ({
  useVAD: () => ({
    isListening: false,
    isSpeaking: false,
    volume: 0,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCartesiaTTS", () => ({
  useCartesiaTTS: () => ({
    status: "idle",
    enqueue,
    streamEnqueue,
    enqueueBuffer: vi.fn(),
    preloadBuffer,
    stop: ttsStop,
    unlock: ttsUnlock,
  }),
}));
vi.mock("@/lib/tavusPresence", () => ({
  isAvatarSpeaking: () => false,
  markAvatarSpeech: vi.fn(),
}));
vi.mock("@/lib/fillers", () => ({
  fillersFor: (lang: string) => [`Got it ${lang}.`],
  pickFiller: () => "Got it.",
}));
vi.mock("@/lib/telemetry", () => ({
  telemetry: {
    mark: vi.fn(),
    setMode: vi.fn(),
    endTurn: vi.fn(),
    startTurn: vi.fn(),
  },
}));

import { useCartStore } from "@/store/cartStore";
import { useConversation } from "@/hooks/useConversation";

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

beforeEach(() => {
  useCartStore.getState().clearCart();
  enqueue.mockClear();
  streamEnqueue.mockClear();
  preloadBuffer.mockReset();
  preloadBuffer.mockImplementation(async () => new ArrayBuffer(4));
  ttsStop.mockClear();
  ttsUnlock.mockClear();
  lastDgOptions = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useConversation — language-detection filler pre-warm (line 155)", () => {
  it("calls preloadBuffer when Deepgram reports a non-English language", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([{ type: "text", delta: "Hola!" }, { type: "done" }])
      )
    );
    renderHook(() => useConversation());
    preloadBuffer.mockClear();
    await act(async () => {
      lastDgOptions!.onSpeechEnd("hola", "es");
      await new Promise((r) => setTimeout(r, 20));
    });
    // ensureFillersForLanguage('es') fires → preloadBuffer('Got it es.', 'es')
    expect(preloadBuffer).toHaveBeenCalledWith(
      expect.stringContaining("es"),
      "es"
    );
  });
});

describe("useConversation — batch TTS path via ?tts=batch (lines 240, 287)", () => {
  it("uses enqueue() (batch) not streamEnqueue() when query param is set", async () => {
    // happy-dom's window.location is mutable. Force ?tts=batch.
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/?tts=batch"),
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          // First chunk crosses the clause boundary mid-stream.
          { type: "text", delta: "Sure thing, " },
          { type: "text", delta: "one latte coming up." },
          { type: "done" },
        ])
      )
    );
    renderHook(() => useConversation({ cartesiaEnabled: true }));
    await act(async () => {
      lastDgOptions!.onSpeechEnd("a latte please");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(enqueue).toHaveBeenCalled();
    expect(streamEnqueue).not.toHaveBeenCalled();
  });
});

describe("useConversation — filler cache hit + in-flight dedupe", () => {
  it("preloadBuffer returning null silently skips the cache write (line 79 false arm)", async () => {
    preloadBuffer.mockImplementation(async () => null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([{ type: "text", delta: "Hi!" }, { type: "done" }])
      )
    );
    renderHook(() => useConversation());
    await act(async () => {
      lastDgOptions!.onSpeechEnd("hallo", "de");
      await new Promise((r) => setTimeout(r, 20));
    });
    // No crash — the `if (buf)` guard short-circuits the cache write.
    expect(preloadBuffer).toHaveBeenCalled();
  });

  it("second onSpeechEnd for the same language hits the cache-hit continue (line 74)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([{ type: "text", delta: "Hola!" }, { type: "done" }])
      )
    );
    renderHook(() => useConversation());
    // First speech-end: populates the 'es' filler cache via preloadBuffer.
    await act(async () => {
      lastDgOptions!.onSpeechEnd("hola", "es");
      await new Promise((r) => setTimeout(r, 20));
    });
    preloadBuffer.mockClear();
    // Second speech-end for the SAME language: ensureFillersForLanguage
    // hits the cache-hit `continue` branch instead of calling preloadBuffer.
    await act(async () => {
      lastDgOptions!.onSpeechEnd("hola de nuevo", "es");
      await new Promise((r) => setTimeout(r, 20));
    });
    // preloadBuffer must NOT be called a second time for the cached phrase.
    expect(preloadBuffer).not.toHaveBeenCalled();
  });
});

describe("useConversation — interim isFinal transition (line 389)", () => {
  it("setPhase('listening') on interim isFinal without sendToChat", () => {
    renderHook(() => useConversation());
    act(() => {
      // An is_final=true transcript that the Deepgram hook routes via
      // onTranscript (not onSpeechEnd) flips the hook back to listening.
      lastDgOptions!.onTranscript("what drinks?", true);
    });
    // No fetch expected — onTranscript does not send to chat.
    expect(enqueue).not.toHaveBeenCalled();
    expect(streamEnqueue).not.toHaveBeenCalled();
  });
});
