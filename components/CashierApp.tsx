"use client";

import { useConversation } from "@/hooks/useConversation";
import { AvatarOverlay } from "@/components/avatar/AvatarOverlay";
import { MicButton } from "@/components/ui/MicButton";
import { BottomSheet } from "@/components/BottomSheet";
import { getOverlayStatus } from "@/lib/overlay";

export function CashierApp() {
  const conversation = useConversation();
  const overlayStatus = getOverlayStatus(
    conversation.phase,
    conversation.deepgramStatus
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Full-screen avatar background */}
      <div className="absolute inset-0">
        {/* Gradient placeholder — will be replaced with Tavus iframe */}
        <div className="w-full h-full bg-gradient-to-b from-zinc-900 via-zinc-800 to-black" />

        {/* Processing indicator */}
        {conversation.phase === "processing" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:0ms]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:150ms]" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/70 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Avatar placeholder icon */}
        {conversation.phase !== "processing" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-32 h-32 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              <svg
                className="w-16 h-16 text-white/20"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Status overlay — top left */}
      <div className="absolute top-6 left-6 z-10">
        <AvatarOverlay status={overlayStatus} />
      </div>

      {/* Live transcript — top center */}
      {(conversation.transcript ||
        (conversation.assistantText &&
          conversation.phase === "responding")) && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 max-w-lg w-[90%]">
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

      {/* Error display */}
      {conversation.error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10">
          <div className="backdrop-blur-xl bg-red-900/40 rounded-xl px-4 py-2 border border-red-500/20">
            <p className="font-sans text-xs text-red-300">
              {conversation.error}
            </p>
          </div>
        </div>
      )}

      {/* Bottom sheet for cart */}
      <BottomSheet />

      {/* Mic button — bottom center */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        {conversation.phase === "idle" && !conversation.error && (
          <p className="font-sans text-xs text-white/40 text-center mb-3">
            Tap to start ordering
          </p>
        )}
        <MicButton
          isListening={conversation.isListening}
          isSpeaking={conversation.isSpeaking}
          onToggle={
            conversation.isListening ? conversation.stop : conversation.start
          }
        />
      </div>
    </div>
  );
}
