"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConversation } from "@/hooks/useConversation";
import { useTavus } from "@/hooks/useTavus";
import { AvatarOverlay } from "@/components/avatar/AvatarOverlay";
import { TavusStage } from "@/components/avatar/TavusStage";
import { MicButton } from "@/components/ui/MicButton";
import { BottomSheet } from "@/components/BottomSheet";
import { getOverlayStatus } from "@/lib/overlay";

export function CashierApp() {
  const conversation = useConversation();
  const overlayStatus = getOverlayStatus(
    conversation.phase,
    conversation.deepgramStatus
  );

  // ?tavus=off in the URL disables the Tavus iframe entirely.
  // Useful for isolating whether the Tavus WebRTC session is stealing
  // the iPad audio output route.
  const tavusEnabled = useMemo(() => {
    if (typeof window === "undefined") return true;
    const params = new URLSearchParams(window.location.search);
    return params.get("tavus") !== "off";
  }, []);

  const tavus = useTavus({
    autoConnect: tavusEnabled,
    warmupDelayMs: 3000,
  });
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

  return (
    <div
      className="relative w-screen overflow-hidden bg-black flex flex-col h-screen"
      style={{
        // h-screen (100vh) is the fallback; 100dvh below wins on iOS
        // 15.4+ and modern desktop browsers so the mic footer tracks
        // the actual visible viewport when toolbars show/hide.
        height: "100dvh",
      }}
    >
      {/* Avatar stage — takes all remaining vertical space */}
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

        <div
          className="absolute left-6 z-10"
          style={{
            top: "max(3rem, calc(env(safe-area-inset-top) + 1.5rem))",
          }}
        >
          <AvatarOverlay status={overlayStatus} />
        </div>

        {(conversation.transcript ||
          (conversation.assistantText &&
            conversation.phase === "responding")) && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-10 max-w-lg w-[90%]"
            style={{
            top: "max(3rem, calc(env(safe-area-inset-top) + 1.5rem))",
          }}
          >
            <div className="backdrop-blur-2xl bg-black/40 rounded-2xl px-5 py-3 border border-white/10">
              {conversation.transcript &&
                conversation.phase === "listening" && (
                  <p className="font-sans text-sm text-white/70 italic text-center">
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
          </div>
        )}

        {conversation.error && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-10"
            style={{
              top: "max(6rem, calc(env(safe-area-inset-top) + 4.5rem))",
            }}
          >
            <div className="backdrop-blur-xl bg-red-900/40 rounded-xl px-4 py-2 border border-red-500/20">
              <p className="font-sans text-xs text-red-300">
                {conversation.error}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Mic footer — flex-sized, always visible above the home indicator.
          Generous bottom padding covers every iPad model (home button or
          gesture bar, portrait or landscape). */}
      <div
        className="relative z-20 flex-shrink-0 flex flex-col items-center w-full"
        style={{
          paddingTop: "0.75rem",
          paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))",
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

      {/* BottomSheet overlays the whole stack (receipt is full-screen, cart
          hovers above the mic footer). Rendered last so it wins the z-stack. */}
      <BottomSheet />
    </div>
  );
}
