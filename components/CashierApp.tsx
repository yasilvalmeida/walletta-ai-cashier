"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useConversation } from "@/hooks/useConversation";
import { useTavus } from "@/hooks/useTavus";
import { useTavusTranscripts } from "@/hooks/useTavusTranscripts";
import { AvatarOverlay } from "@/components/avatar/AvatarOverlay";
import { TavusStage } from "@/components/avatar/TavusStage";
import { MicButton } from "@/components/ui/MicButton";
import { BottomSheet } from "@/components/BottomSheet";
import { LatencyOverlay } from "@/components/debug/LatencyOverlay";
import { getOverlayStatus } from "@/lib/overlay";
import { markAvatarSpeech } from "@/lib/tavusPresence";
import { useCartStore } from "@/store/cartStore";

export function CashierApp() {
  // tavusEnabled is computed from URL params on mount. Non-English
  // demos (`?lang=es`, `?lang=zh`, ...) force Cartesia-only mode
  // because the stock replica is an English voice clone — Tavus's lip
  // sync would mouth English shapes over Spanish/Mandarin audio and
  // shatter the "real person" illusion.
  const tavusEnabled = useMemo(() => {
    if (typeof window === "undefined") return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tavus") === "off") return false;
    const lang = params.get("lang");
    if (lang && lang !== "en") return false;
    return true;
  }, []);

  // ?debug=receipt pre-populates the cart and opens the receipt modal so
  // we can watch whether the QR / order id change over time without having
  // to drive the whole voice flow.
  const addItem = useCartStore((s) => s.addItem);
  const setReceiptReady = useCartStore((s) => s.setReceiptReady);
  const debugReceiptRef = useRef(false);
  useEffect(() => {
    if (debugReceiptRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") !== "receipt") return;
    debugReceiptRef.current = true;
    addItem({
      product_id: "oat-milk-latte",
      product_name: "Oat Milk Latte",
      quantity: 1,
      unit_price: 6.5,
      size: "12oz",
      modifiers: [{ label: "Oat Milk", price: 0.75 }],
    });
    addItem({
      product_id: "butter-croissant",
      product_name: "Butter Croissant",
      quantity: 2,
      unit_price: 4.5,
    });
    addItem({
      product_id: "green-smoothie",
      product_name: "Green Goddess Smoothie",
      quantity: 1,
      unit_price: 12,
    });
    setReceiptReady(true);
  }, [addItem, setReceiptReady]);

  const tavus = useTavus({
    autoConnect: tavusEnabled,
    // Was 3000ms — left the user staring at a black gradient for 3 full
    // seconds after they tapped the mic. Session creation now fires at
    // page mount (the slowest part at ~1.5-2s), so by the time the user
    // taps the mic the conversation_url is usually already cached and
    // the iframe handshake can start immediately.
    warmupDelayMs: 0,
  });

  // Pre-warm the Vercel serverless routes on mount so the first real
  // request doesn't eat the Node cold-start (~200-500ms each). Both
  // payloads fail schema validation deliberately — the route returns
  // 400 fast without calling OpenAI / Cartesia, but the Node VM is
  // primed for the next real call.
  useEffect(() => {
    const warmChat = fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
    const warmTts = fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
    void Promise.allSettled([warmChat, warmTts]);
  }, []);

  // Voice mode: use Cartesia whenever the avatar is NOT in the session.
  //  - idle  → user ended the call or never started → Cartesia speaks
  //  - error → Tavus failed (e.g. concurrent-limit 400) → Cartesia speaks
  //  - connecting / connected → avatar is loading, stay silent briefly
  //  - ready → avatar is the voice, Cartesia stays silent
  const cartesiaEnabled =
    !tavusEnabled ||
    tavus.status === "idle" ||
    tavus.status === "error";

  const conversation = useConversation({
    cartesiaEnabled,
  });

  // Subscribe to Tavus's replica transcript stream purely for the
  // echo guard — each arrival refreshes a "avatar is audibly speaking"
  // window that useConversation checks before routing Deepgram output
  // to /api/chat. We explicitly do NOT feed these transcripts into
  // the chat pipeline (see onUserTranscript left undefined) because
  // Deepgram remains the authoritative user-speech source.
  const tavusConversationId = tavus.session?.conversationId ?? "";
  const tavusConversationIds = useMemo(
    () => (tavusConversationId ? [tavusConversationId] : []),
    [tavusConversationId]
  );
  useTavusTranscripts({
    conversationIds: tavusConversationIds,
    onReplicaTranscript: () => markAvatarSpeech(),
  });

  // Cart is fed by our Deepgram → /api/chat pipeline in BOTH modes.
  // No Tavus-side bridge — spec'd M2 architecture: user speech →
  // Deepgram STT → GPT-4o (with catalog in system prompt + hotwords
  // in Deepgram) → SSE cart_action events → cart_store. The Tavus
  // avatar handles voice output via its own internal pipeline and is
  // decoupled from our cart logic.

  // When the receipt slides up, end the Tavus call AFTER a short delay
  // so the avatar's closing "your receipt is up, thanks" can finish —
  // disconnecting the instant the snapshot lands would clip the goodbye
  // mid-word. 2 s covers a short one-sentence close, which is all the
  // persona prompt allows. The persona is also instructed to stay silent
  // after finalize_order, so this delay is a UX cushion, not a conversation
  // continuation.
  const receiptSnapshot = useCartStore((s) => s.receiptSnapshot);
  useEffect(() => {
    if (!receiptSnapshot) return;
    if (tavus.status === "idle" || tavus.status === "error") return;
    const timer = setTimeout(() => tavus.disconnect(), 2000);
    return () => clearTimeout(timer);
  }, [receiptSnapshot, tavus]);

  // Auto-fallback to Cartesia-only when two consecutive turns come in
  // non-English. The stock Tavus replica is an English voice clone, so
  // letting it keep speaking over Spanish/Mandarin audio produces a
  // lip-sync mismatch that reads as broken. Two-turn streak avoids
  // tearing Tavus down on a single mis-detection.
  const nonEnStreakRef = useRef(0);
  useEffect(() => {
    if (!conversation.turnIndex) return;
    const lang = conversation.detectedLanguage;
    if (!lang) return;
    if (lang === "en") {
      nonEnStreakRef.current = 0;
      return;
    }
    nonEnStreakRef.current += 1;
    if (
      nonEnStreakRef.current >= 2 &&
      (tavus.status === "ready" || tavus.status === "connected")
    ) {
      console.log(
        "[CashierApp] Non-English (",
        lang,
        ") detected 2x — switching to Cartesia-only"
      );
      tavus.disconnect();
    }
  }, [conversation.turnIndex, conversation.detectedLanguage, tavus]);

  // When the customer taps "New Order" (receipt snapshot goes from set
  // → null), reboot the Tavus session so the avatar is live again for
  // the next customer. Without this the iframe stays torn down and the
  // user sees a dead gradient with no audio.
  const prevSnapshotCaRef = useRef(receiptSnapshot);
  useEffect(() => {
    const prev = prevSnapshotCaRef.current;
    prevSnapshotCaRef.current = receiptSnapshot;
    if (prev && !receiptSnapshot && tavusEnabled) {
      console.log("[CashierApp] New order — reconnecting Tavus");
      void tavus.connect();
    }
  }, [receiptSnapshot, tavusEnabled, tavus]);
  const overlayStatus = getOverlayStatus(
    conversation.phase,
    conversation.deepgramStatus
  );

  const [hasInteracted, setHasInteracted] = useState(false);
  const interactedRef = useRef(false);

  const handleMicToggle = useCallback(() => {
    if (!interactedRef.current) {
      interactedRef.current = true;
      setHasInteracted(true);
    }
    if (conversation.isListening) {
      conversation.stop();
    } else {
      void conversation.start();
    }
  }, [conversation]);

  // Daily (and therefore Tavus) posts a "left-meeting" message from inside
  // the iframe when the user hangs up. Listen for it and tear the session
  // down so the app falls back to Cartesia and the Rejoin button shows.
  const tavusDisconnectRef = useRef(tavus.disconnect);
  tavusDisconnectRef.current = tavus.disconnect;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      const rec = data as Record<string, unknown>;
      const signals = [rec.action, rec.event, rec.type].filter(
        (v) => typeof v === "string"
      ) as string[];
      if (
        signals.some(
          (s) =>
            s === "left-meeting" ||
            s === "meeting-ended" ||
            s === "call-ended" ||
            s === "participant-left"
        )
      ) {
        tavusDisconnectRef.current();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleTavusToggle = useCallback(() => {
    if (tavus.status === "ready" || tavus.status === "connected") {
      tavus.disconnect();
    } else {
      if (!interactedRef.current) {
        interactedRef.current = true;
        setHasInteracted(true);
      }
      void tavus.connect();
    }
  }, [tavus]);

  // While Tavus is the voice, our Deepgram transcript and our
  // /api/chat assistant text are unrelated to what the avatar is
  // actually saying — keep them hidden to avoid confusing the user.
  const tavusVoiceActive =
    tavusEnabled &&
    (tavus.status === "ready" || tavus.status === "connected");
  const showTranscript =
    !tavusVoiceActive &&
    (!!conversation.transcript ||
      (!!conversation.assistantText &&
        conversation.phase === "responding"));

  return (
    <div
      className="relative w-screen overflow-hidden bg-black flex flex-col h-screen"
      style={{ height: "100dvh" }}
    >
      {/* Top row — flex item, content-sized. Safe-area padding keeps it
          clear of Safari's URL / tab bar, even with multiple tabs open. */}
      <div
        className="flex-shrink-0 relative z-20 w-full flex items-start gap-3 px-4"
        style={{
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          paddingBottom: "0.5rem",
        }}
      >
        <div className="flex-shrink-0 pt-1">
          <AvatarOverlay status={overlayStatus} />
        </div>
        <div className="flex-1 min-w-0 flex justify-center">
          {showTranscript && (
            <div className="backdrop-blur-md bg-black/55 rounded-2xl px-4 py-2 border border-white/10 max-w-lg w-full">
              {conversation.transcript &&
                conversation.phase === "listening" && (
                  <p className="font-sans text-sm text-white/70 italic text-center truncate">
                    &ldquo;{conversation.transcript}&rdquo;
                  </p>
                )}
              {conversation.assistantText &&
                conversation.phase === "responding" && (
                  <p className="font-sans text-sm text-white/90 text-center">
                    {conversation.assistantText}
                  </p>
                )}
            </div>
          )}
        </div>
        {/* End / Rejoin control. Hidden until the user engages — pre-
            interaction the screen stays chrome-free per Temur's Apr 22
            ask for a portrait "window to a real person, not a website". */}
        {tavusEnabled && (hasInteracted || tavus.status === "error") && (
          <div className="flex-shrink-0 pt-1">
            <button
              onClick={handleTavusToggle}
              className="backdrop-blur-md bg-black/50 border border-white/10 rounded-full px-3 py-1.5 text-xs font-sans text-white/80 hover:bg-black/60 transition-colors"
              aria-label={
                tavus.status === "ready" || tavus.status === "connected"
                  ? "End avatar call"
                  : "Rejoin avatar call"
              }
            >
              {tavus.status === "ready" || tavus.status === "connected"
                ? "End call"
                : tavus.status === "connecting"
                  ? "Cancel"
                  : "Rejoin"}
            </button>
          </div>
        )}
      </div>

      {/* Avatar stage — flex-1 fills remaining vertical space and shrinks
          gracefully when the viewport gets shorter (multi-tab Safari). */}
      <div className="relative flex-1 min-h-0 w-full">
        {tavusEnabled ? (
          <TavusStage
            conversationUrl={tavus.session?.conversationUrl ?? null}
            status={tavus.status}
            errorMessage={tavus.error}
            // Show the avatar the instant the iframe handshake is
            // ready, not only after the customer taps the mic. A black
            // gradient pre-interaction reads as a broken kiosk; a live
            // face reads as "a window to a real person" (Temur Apr 22).
            visible={tavus.status === "connected" || tavus.status === "ready"}
            onReady={tavus.markReady}
            onRetry={() => void tavus.connect()}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-zinc-800 to-black" />
        )}

        {/* Processing dots only in Cartesia mode (no avatar face to
            convey thinking). In Tavus mode the avatar's own idle
            animation + the MicButton thinking ring cover it without
            layering a second spinner over the face. */}
        {conversation.phase === "processing" && tavus.status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:0ms]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:150ms]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <AnimatePresence>
          {conversation.error && (
            <motion.div
              key={conversation.error}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-sm w-[90%]"
            >
              <div className="backdrop-blur-md bg-red-900/55 rounded-full px-4 py-2 border border-red-500/25">
                <p className="font-sans text-xs text-red-100 text-center">
                  {conversation.error}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mic footer — flex item, content-sized, always above the home
          indicator regardless of iPad model or orientation. */}
      <div
        className="flex-shrink-0 relative z-20 flex flex-col items-center w-full"
        style={{
          paddingTop: "0.75rem",
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* "Tap to start ordering" text removed Apr 22 — the mic-button
            affordance is enough, and the label read as website chrome. */}
        <MicButton
          isListening={conversation.isListening}
          isSpeaking={conversation.isSpeaking}
          isThinking={conversation.phase === "processing"}
          onToggle={handleMicToggle}
        />
      </div>

      {/* BottomSheet overlays everything above (z-30 for receipt, z-10 for
          the cart drawer). Rendered last so it wins the z-stack. */}
      <BottomSheet />
      <LatencyOverlay />
    </div>
  );
}
