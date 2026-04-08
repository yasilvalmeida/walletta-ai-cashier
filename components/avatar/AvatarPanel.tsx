"use client";

import { AvatarOverlay } from "@/components/avatar/AvatarOverlay";
import { MicButton } from "@/components/ui/MicButton";

type ConversationPhase =
  | "idle"
  | "listening"
  | "processing"
  | "responding"
  | "error";

interface AvatarPanelProps {
  phase: ConversationPhase;
  isSpeaking: boolean;
  volume: number;
  transcript: string;
  assistantText: string;
  error: string | null;
  deepgramStatus: "idle" | "connecting" | "connected" | "error";
  onStart: () => void;
  onStop: () => void;
  isListening: boolean;
}

function getOverlayStatus(
  phase: ConversationPhase,
  deepgramStatus: string
): "idle" | "connecting" | "connected" | "listening" | "processing" | "speaking" | "error" {
  if (phase === "error") return "error";
  if (deepgramStatus === "connecting") return "connecting";
  if (phase === "responding") return "speaking";
  if (phase === "processing") return "processing";
  if (phase === "listening") return "listening";
  if (deepgramStatus === "connected") return "connected";
  return "idle";
}

export function AvatarPanel({
  phase,
  isSpeaking,
  volume,
  transcript,
  assistantText,
  error,
  deepgramStatus,
  onStart,
  onStop,
  isListening,
}: AvatarPanelProps) {
  const overlayStatus = getOverlayStatus(phase, deepgramStatus);

  // Pulsing ring scale based on volume (0-100 range)
  const pulseScale = isListening && isSpeaking ? 1 + (volume / 200) : 1;

  return (
    <div className="relative h-full w-full bg-surface-elevated flex flex-col items-center justify-center">
      {/* Avatar visual area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        {/* Avatar circle with volume ring */}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full bg-accent/10 transition-transform duration-100"
            style={{ transform: `scale(${pulseScale})` }}
          />
          <div className="relative w-32 h-32 rounded-full bg-accent/10 flex items-center justify-center">
            {phase === "processing" ? (
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
              </div>
            ) : (
              <svg
                className="w-16 h-16 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
            )}
          </div>
        </div>

        {/* Transcript display */}
        {transcript && phase === "listening" && (
          <div className="max-w-md text-center">
            <p className="font-sans text-sm text-text-secondary italic">
              &ldquo;{transcript}&rdquo;
            </p>
          </div>
        )}

        {/* Assistant response */}
        {assistantText && (phase === "responding" || phase === "listening") && (
          <div className="max-w-md text-center">
            <p className="font-sans text-sm text-text-primary">
              {assistantText}
            </p>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="max-w-md text-center">
            <p className="font-sans text-xs text-destructive">{error}</p>
          </div>
        )}

        {/* Idle prompt */}
        {phase === "idle" && !error && (
          <p className="font-sans text-sm text-text-muted">
            Tap the mic to start ordering
          </p>
        )}
      </div>

      {/* Mic button */}
      <div className="pb-8">
        <MicButton
          isListening={isListening}
          isSpeaking={isSpeaking}
          onToggle={isListening ? onStop : onStart}
        />
      </div>

      <AvatarOverlay status={overlayStatus} />
    </div>
  );
}
