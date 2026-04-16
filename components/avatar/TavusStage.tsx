"use client";

import { useCallback } from "react";

interface TavusStageProps {
  conversationUrl: string | null;
  status: "idle" | "connecting" | "connected" | "ready" | "error";
  errorMessage: string | null;
  canMount: boolean;
  onReady: () => void;
  onRetry: () => void;
}

export function TavusStage({
  conversationUrl,
  status,
  errorMessage,
  canMount,
  onReady,
  onRetry,
}: TavusStageProps) {
  const handleLoad = useCallback(() => {
    onReady();
  }, [onReady]);

  const shouldMount = canMount && !!conversationUrl;
  const isLoading =
    status === "connecting" || (status === "connected" && shouldMount);
  const isReady = status === "ready";

  return (
    <div className="absolute inset-0 bg-[#1A1714] overflow-hidden">
      {shouldMount ? (
        <iframe
          key={conversationUrl}
          src={conversationUrl ?? undefined}
          allow="camera; microphone; fullscreen; display-capture; autoplay"
          allowFullScreen
          className="w-full h-full border-0"
          title="Erewhon Cashier"
          onLoad={handleLoad}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-b from-zinc-900 via-zinc-800 to-black" />
      )}

      {isLoading && !isReady && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
            <p className="font-display text-lg text-white/70">
              Preparing your cashier…
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <p className="font-display text-lg text-white/80">
              Avatar unavailable
            </p>
            {errorMessage && (
              <p className="font-sans text-xs text-white/50 max-w-sm">
                {errorMessage}
              </p>
            )}
            <button
              onClick={onRetry}
              className="mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full font-sans text-xs text-white/80 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="absolute top-6 right-6 z-10 flex items-center gap-2 backdrop-blur-xl bg-black/40 rounded-full px-3 py-1.5 border border-white/10">
        <span
          className={
            "w-2 h-2 rounded-full " +
            (status === "ready"
              ? "bg-emerald-400"
              : status === "connected" || status === "connecting"
                ? "bg-amber-400 animate-pulse"
                : status === "error"
                  ? "bg-red-400"
                  : "bg-white/30")
          }
        />
        <span className="font-sans text-xs text-white/60">
          {status === "ready"
            ? "Live"
            : status === "connected"
              ? "Loading avatar"
              : status === "connecting"
                ? "Connecting"
                : status === "error"
                  ? "Offline"
                  : "Standby"}
        </span>
      </div>
    </div>
  );
}
