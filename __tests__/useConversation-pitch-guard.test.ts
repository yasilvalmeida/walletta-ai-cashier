// @vitest-environment happy-dom
//
// Covers the investor-pitch hand-off inside useConversation:
//   - onSpeechEnd("present the company") invokes onPresentCompany
//     and does NOT route to /api/chat.
//   - isPitchingRef.current === true suppresses any transcript from
//     reaching /api/chat (pitch monologue guard).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let lastDg: {
  onTranscript: (t: string, isFinal: boolean) => void;
  onSpeechEnd: (t: string, language?: string) => void;
} | null = null;

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
    enqueueBuffer: vi.fn(),
    preloadBuffer: vi.fn(async () => null),
    stop: vi.fn(),
    unlock: vi.fn(),
  }),
}));
vi.mock("@/lib/tavusPresence", () => ({
  isAvatarSpeaking: () => false,
  markAvatarSpeech: vi.fn(),
}));
vi.mock("@/lib/fillers", () => ({
  fillersFor: () => [],
  pickFiller: () => "",
}));
vi.mock("@/lib/telemetry", () => ({
  telemetry: {
    mark: vi.fn(),
    setMode: vi.fn(),
    endTurn: vi.fn(),
    startTurn: vi.fn(),
  },
}));

import { useConversation } from "@/hooks/useConversation";
import { useRef } from "react";

beforeEach(() => {
  lastDg = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useConversation — pitch trigger + guard", () => {
  it("onSpeechEnd(\"present the company\") hands off and skips /api/chat", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onPresentCompany = vi.fn();
    renderHook(() => useConversation({ onPresentCompany }));
    await act(async () => {
      lastDg!.onSpeechEnd("Present the company");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onPresentCompany).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pitch variants ('pitch Walletta', 'investor pitch') trigger the hand-off", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onPresentCompany = vi.fn();
    renderHook(() => useConversation({ onPresentCompany }));
    await act(async () => {
      lastDg!.onSpeechEnd("pitch Walletta");
      await new Promise((r) => setTimeout(r, 5));
    });
    await act(async () => {
      lastDg!.onSpeechEnd("give the pitch now");
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(onPresentCompany).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("non-trigger speech still routes to /api/chat", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const onPresentCompany = vi.fn();
    renderHook(() => useConversation({ onPresentCompany }));
    await act(async () => {
      lastDg!.onSpeechEnd("I'd like a matcha please");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(onPresentCompany).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("isPitchingRef.current === true blocks all Deepgram → /api/chat routing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // Pattern: caller owns the ref (same as CashierApp does) and flips
    // it true while the pitch is playing.
    function Harness() {
      const isPitchingRef = useRef(true);
      return useConversation({ isPitchingRef });
    }
    renderHook(() => Harness());
    await act(async () => {
      lastDg!.onSpeechEnd("I'd like a matcha please");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
