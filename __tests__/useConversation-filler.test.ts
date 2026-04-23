// @vitest-environment happy-dom
//
// Covers lines 99-100 of useConversation — the playFillerForLanguage
// success branch where a cached buffer lands in the TTS queue via
// enqueueBuffer(buf.slice(0)). Needs the English filler cache to be
// populated on mount (which happens when preloadBuffer resolves).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

let lastDg: {
  onSpeechEnd: (t: string, l?: string) => void;
} | null = null;

const enqueueBuffer = vi.fn();
const preloadBuffer = vi.fn(async () => new ArrayBuffer(8));

vi.mock("@/hooks/useDeepgram", () => ({
  useDeepgram: (opts: typeof lastDg) => {
    lastDg = opts;
    return { status: "idle", connect: vi.fn(), disconnect: vi.fn() };
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
    enqueue: vi.fn(),
    streamEnqueue: vi.fn(),
    enqueueBuffer,
    preloadBuffer,
    stop: vi.fn(),
    unlock: vi.fn(),
  }),
}));
vi.mock("@/lib/fillers", () => ({
  fillersFor: () => ["Got it."],
  pickFiller: () => "Got it.",
}));
vi.mock("@/lib/tavusPresence", () => ({
  isAvatarSpeaking: () => false,
  markAvatarSpeech: vi.fn(),
}));
vi.mock("@/lib/telemetry", () => ({
  telemetry: {
    mark: vi.fn(),
    setMode: vi.fn(),
    endTurn: vi.fn(),
  },
}));

import { useConversation } from "@/hooks/useConversation";

beforeEach(() => {
  enqueueBuffer.mockClear();
  preloadBuffer.mockClear();
  lastDg = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useConversation — cached filler playback", () => {
  it("calls enqueueBuffer when a cached filler exists for the turn's language", async () => {
    // Respond to /api/chat with a minimal SSE.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
      )
    );
    const { result } = renderHook(() => useConversation());
    // Wait for the mount-time preload to populate the cache.
    await waitFor(() => expect(preloadBuffer).toHaveBeenCalled());
    await act(async () => {
      lastDg!.onSpeechEnd("hello");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(enqueueBuffer).toHaveBeenCalled();
    // Must be invoked with an ArrayBuffer (the sliced copy).
    expect(enqueueBuffer.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
    // And the source Turn has left 'idle'.
    expect(result.current.turnIndex).toBeGreaterThan(0);
  });
});
