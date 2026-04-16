"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@/hooks/useConversation";
import { useTavus } from "@/hooks/useTavus";
import { useTavusTranscripts } from "@/hooks/useTavusTranscripts";
import { AvatarOverlay } from "@/components/avatar/AvatarOverlay";
import { TavusStage } from "@/components/avatar/TavusStage";
import { MicButton } from "@/components/ui/MicButton";
import { BottomSheet } from "@/components/BottomSheet";
import { getOverlayStatus } from "@/lib/overlay";
import { useCartStore } from "@/store/cartStore";

export function CashierApp() {
  const tavusEnabled = useMemo(() => {
    if (typeof window === "undefined") return true;
    const params = new URLSearchParams(window.location.search);
    return params.get("tavus") !== "off";
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
    warmupDelayMs: 3000,
  });

  // Voice mode: use Cartesia whenever the avatar is NOT in the session.
  //  - idle  → user ended the call or never started → Cartesia speaks
  //  - error → Tavus failed (e.g. concurrent-limit 400) → Cartesia speaks
  //  - connecting / connected → avatar is loading, stay silent briefly
  //  - ready → avatar is the voice, Cartesia stays silent
  const cartesiaEnabled =
    !tavusEnabled ||
    tavus.status === "idle" ||
    tavus.status === "error";

  // When the Tavus avatar is actively the voice we take transcripts from
  // Tavus's server-side STT (via /api/tavus/webhook → SSE) and tell
  // useConversation to ignore Deepgram's speech-end — otherwise iOS's
  // shared mic + echo would double-feed / loop the chat pipeline.
  const tavusTranscriptsActive =
    tavusEnabled &&
    (tavus.status === "ready" || tavus.status === "connected");

  const conversation = useConversation({
    cartesiaEnabled,
    tavusTranscriptsActive,
  });

  // Keep the SSE subscription open for a short grace period after Tavus
  // disconnects. Tavus only emits application.transcription_ready AFTER
  // system.shutdown, so if we close the channel the moment the user
  // hangs up we miss the full-conversation transcript and the cart
  // never populates. 60s is plenty — Tavus normally sends the ready
  // event within a few seconds of shutdown.
  const [trailingConversationId, setTrailingConversationId] = useState<
    string | null
  >(null);
  useEffect(() => {
    const id = tavus.session?.conversationId ?? null;
    if (id) {
      setTrailingConversationId(id);
      return;
    }
    if (!trailingConversationId) return;
    const timer = setTimeout(() => setTrailingConversationId(null), 60000);
    return () => clearTimeout(timer);
  }, [tavus.session?.conversationId, trailingConversationId]);

  useTavusTranscripts({
    conversationId: trailingConversationId,
    onUserTranscript: conversation.sendExternalTranscript,
  });

  // When the receipt is ready, end the Tavus call. The user has just
  // finished ordering — leaving the avatar running behind the modal
  // wastes a concurrent-conversation slot and makes the checkout screen
  // feel like the avatar is about to speak again.
  const receiptSnapshot = useCartStore((s) => s.receiptSnapshot);
  useEffect(() => {
    if (!receiptSnapshot) return;
    if (tavus.status === "idle" || tavus.status === "error") return;
    tavus.disconnect();
  }, [receiptSnapshot, tavus]);
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
  const showTranscript =
    !tavusTranscriptsActive &&
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
            <div className="backdrop-blur-2xl bg-black/40 rounded-2xl px-4 py-2 border border-white/10 max-w-lg w-full">
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
        {/* End / Rejoin control on the right. Only shown when the Tavus
            avatar is in scope (?tavus=off hides it entirely). */}
        {tavusEnabled && (
          <div className="flex-shrink-0 pt-1">
            <button
              onClick={handleTavusToggle}
              className="backdrop-blur-xl bg-black/40 border border-white/10 rounded-full px-3 py-1.5 text-xs font-sans text-white/80 hover:bg-black/60 transition-colors"
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
            canMount={hasInteracted}
            onReady={tavus.markReady}
            onRetry={() => void tavus.connect()}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-zinc-800 to-black" />
        )}

        {conversation.phase === "processing" && tavus.status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:0ms]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:150ms]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {conversation.error && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-sm w-[90%]">
            <div className="backdrop-blur-xl bg-red-900/40 rounded-xl px-4 py-2 border border-red-500/20">
              <p className="font-sans text-xs text-red-300 text-center">
                {conversation.error}
              </p>
            </div>
          </div>
        )}
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
        {conversation.phase === "idle" && !conversation.error && (
          <p className="font-sans text-xs text-white/40 text-center mb-2.5">
            Tap to start ordering
          </p>
        )}
        <MicButton
          isListening={conversation.isListening}
          isSpeaking={conversation.isSpeaking}
          onToggle={handleMicToggle}
        />
      </div>

      {/* BottomSheet overlays everything above (z-30 for receipt, z-10 for
          the cart drawer). Rendered last so it wins the z-stack. */}
      <BottomSheet />
    </div>
  );
}
