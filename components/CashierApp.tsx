"use client";

import { useCallback, useRef, useState } from "react";
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

  const tavus = useTavus({ autoConnect: true, warmupDelayMs: 3000 });
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
    <div className="relative h-dvh w-screen overflow-hidden bg-black">
      <TavusStage
        conversationUrl={tavus.session?.conversationUrl ?? null}
        status={tavus.status}
        errorMessage={tavus.error}
        canMount={hasInteracted}
        onReady={tavus.markReady}
        onRetry={() => void tavus.connect()}
      />

      {conversation.phase === "processing" && tavus.status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:0ms]" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:150ms]" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}

      <div className="absolute top-[calc(1.5rem+env(safe-area-inset-top))] left-6 z-10">
        <AvatarOverlay status={overlayStatus} />
      </div>

      {(conversation.transcript ||
        (conversation.assistantText &&
          conversation.phase === "responding")) && (
        <div className="absolute top-[calc(1.5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-10 max-w-lg w-[90%]">
          <div className="backdrop-blur-2xl bg-black/40 rounded-2xl px-5 py-3 border border-white/10">
            {conversation.transcript && conversation.phase === "listening" && (
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
        <div className="absolute top-[calc(5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-10">
          <div className="backdrop-blur-xl bg-red-900/40 rounded-xl px-4 py-2 border border-red-500/20">
            <p className="font-sans text-xs text-red-300">
              {conversation.error}
            </p>
          </div>
        </div>
      )}

      <BottomSheet />

      <div
        className="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center pointer-events-none"
        style={{
          paddingBottom:
            "max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))",
          paddingTop: "0.5rem",
        }}
      >
        {conversation.phase === "idle" && !conversation.error && (
          <p className="font-sans text-xs text-white/40 text-center mb-3 pointer-events-auto">
            Tap to start ordering
          </p>
        )}
        <div className="pointer-events-auto">
          <MicButton
            isListening={conversation.isListening}
            isSpeaking={conversation.isSpeaking}
            onToggle={handleMicToggle}
          />
        </div>
      </div>
    </div>
  );
}
