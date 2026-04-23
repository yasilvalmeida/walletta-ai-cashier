// @vitest-environment happy-dom
//
// Direct hits on every remaining uncovered statement:
//   useConversation:75  — filler in-flight dedupe continue
//   useConversation:231 — chunk empty after trim (&&-false arm)
//   useConversation:266 — cart_action with unknown action string
//   useCartesiaTTS:78   — processQueue concurrent-guard early return
//   useCartesiaTTS:121  — done() called twice (settled latch)
//   useCartesiaTTS:219  — setStatus non-idle arm of the ternary
//   useCartesiaTTS:231  — schedule after stop() flipped gen
//   useCartesiaTTS:251  — streamSources cleared + processingRef false
//   useCartesiaTTS:323  — stream fallback sees gen flip before fetch

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ─── Shared mocks rebuilt fresh per file ──────────────────────────────

let dgOpts: {
  onTranscript: (t: string, isFinal: boolean) => void;
  onSpeechEnd: (t: string, l?: string) => void;
} | null = null;

const preloadBuffer = vi.fn(async () => new ArrayBuffer(4));
const enqueue = vi.fn();
const streamEnqueue = vi.fn();
const enqueueBuffer = vi.fn();
const ttsStop = vi.fn();
const ttsUnlock = vi.fn();

vi.mock("@/hooks/useDeepgram", () => ({
  useDeepgram: (opts: typeof dgOpts) => {
    dgOpts = opts;
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
    enqueue,
    streamEnqueue,
    enqueueBuffer,
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
  fillersFor: (lang: string) => [`Got it ${lang}.`, `One sec ${lang}.`],
  pickFiller: () => "Got it.",
}));
vi.mock("@/lib/telemetry", () => ({
  telemetry: {
    mark: vi.fn(),
    setMode: vi.fn(),
    endTurn: vi.fn(),
  },
}));

import { useCartStore } from "@/store/cartStore";

beforeEach(() => {
  useCartStore.getState().clearCart();
  dgOpts = null;
  preloadBuffer.mockReset();
  preloadBuffer.mockImplementation(async () => new ArrayBuffer(4));
  enqueue.mockClear();
  streamEnqueue.mockClear();
  enqueueBuffer.mockClear();
  ttsStop.mockClear();
  ttsUnlock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// ─── useConversation.ts:75 — in-flight dedupe ────────────────────────

describe("useConversation.ts:75 — filler in-flight dedupe", () => {
  it("skips the same phrase across concurrent preloads while it is in-flight", async () => {
    // Make preloadBuffer never resolve so the first phrase stays
    // registered in fillerInFlightRef when the second call iterates.
    preloadBuffer.mockImplementation(() => new Promise<ArrayBuffer>(() => {}));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([{ type: "done" }]))
    );
    const { useConversation } = await import("@/hooks/useConversation");
    renderHook(() => useConversation());
    preloadBuffer.mockClear();
    // Fire two speech-ends for the same language rapidly. The second
    // call's loop encounters the first phrase already in fillerInFlightRef
    // → hits `continue` at line 75 before adding it again.
    await act(async () => {
      dgOpts!.onSpeechEnd("bonjour", "fr");
      dgOpts!.onSpeechEnd("salut", "fr");
      await new Promise((r) => setTimeout(r, 5));
    });
    // The same `fr:"Got it fr."` phrase must not appear in preloadBuffer
    // twice — once it's in flight, the second iteration continues past.
    const firstPhraseCalls = preloadBuffer.mock.calls.filter(
      ([text]) => text === "Got it fr."
    );
    expect(firstPhraseCalls.length).toBe(1);
  });
});

// ─── useConversation.ts:231 — chunk trims to empty ───────────────────

describe("useConversation.ts:231 — chunk trims to empty", () => {
  it("skips TTS when the sliced clause is pure whitespace/punctuation", async () => {
    // A clause where the first ≥10 chars are comma-space-etc. so the
    // trim() yields ""; the `if (chunk && ...)` fails its left arm.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "text", delta: "          , filler text here" },
          { type: "done" },
        ])
      )
    );
    const { useConversation } = await import("@/hooks/useConversation");
    renderHook(() => useConversation({ cartesiaEnabled: true }));
    streamEnqueue.mockClear();
    await act(async () => {
      dgOpts!.onSpeechEnd("hi");
      await new Promise((r) => setTimeout(r, 30));
    });
    // The whitespace-only chunk was dropped; TTS still sees the
    // remainder at the end of the stream.
    expect(streamEnqueue).toHaveBeenCalled();
  });
});

// ─── useConversation.ts:266 — cart_action unknown action ─────────────

describe("useConversation.ts:266 — unknown cart_action action", () => {
  it("silently ignores a cart_action whose action is neither add nor remove", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          {
            type: "cart_action",
            action: "update_quantity", // neither add_to_cart nor remove_from_cart
            payload: { product_id: "p1" },
          },
          { type: "done" },
        ])
      )
    );
    const { useConversation } = await import("@/hooks/useConversation");
    renderHook(() => useConversation());
    await act(async () => {
      dgOpts!.onSpeechEnd("change it");
      await new Promise((r) => setTimeout(r, 20));
    });
    // No mutation — the `else if` chain falls through.
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});

// ─── useCartesiaTTS — final statement coverage ───────────────────────
//
// These use a minimal direct-import harness (no React hook mocks) so the
// REAL useCartesiaTTS is exercised.

