"use client";

import { useCallback, useMemo } from "react";

interface TavusStageProps {
  conversationUrl: string | null;
  status: "idle" | "connecting" | "connected" | "ready" | "error";
  errorMessage: string | null;
  // When false the iframe is still mounted (so the WebRTC handshake can
  // run in the background and be ready by the time the customer taps
  // the mic), but rendered opacity-0 + pointer-events-none so the user
  // never sees a blank Daily.co call screen pre-interaction.
  visible: boolean;
  onReady: () => void;
  onRetry: () => void;
}

// Tavus hands us a Daily.co prebuilt room URL. The prebuilt UI ships
// with a full meeting toolbar (Mute / Turn off / People / Leave),
// speaker-view toggle, self-view thumbnail, "N people in call" banner,
// and a pre-join screen — that chrome is exactly what Temur's Apr 22
// feedback called a "standard web dashboard". Daily prebuilt honors a
// handful of URL params that suppress these controls; appending them
// here keeps the iframe visual-only without needing a full Daily JS
// SDK refactor.
//
// Refs:
// - https://docs.daily.co/reference/daily-js/daily-prebuilt-url
// - https://docs.tavus.io (conversation_url is a Daily room)
function applyDailyChromeSuppression(url: string): string {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const ensure = (key: string, value: string) => {
      if (!params.has(key)) params.set(key, value);
    };
    // Hide the bottom meeting toolbar (Mute/Cam/People/Leave).
    ensure("showLeaveButton", "false");
    ensure("showFullscreenButton", "false");
    // Hide the self-preview thumbnail — the customer shouldn't see
    // themselves in the corner while ordering from the cashier.
    ensure("showLocalVideo", "false");
    // Hide the participants-count banner at the top.
    ensure("showParticipantsBar", "false");
    // Skip the "Are you ready to join? / device check" pre-join screen
    // Temur hit on IMG_9299 frame 1. Daily prebuilt calls this the
    // "hair check" step.
    ensure("hairCheck", "false");
    // Focus the replica participant — prevents the speaker-view /
    // gallery-view toggle from showing.
    ensure("activeSpeakerMode", "true");
    // Transparent background so the avatar composites cleanly over
    // our app's dark shell instead of Daily's default white frame.
    ensure("bg", "transparent");
    return parsed.toString();
  } catch {
    // If the URL can't be parsed for some reason, fall back to the raw
    // string — better a working iframe with chrome than no iframe.
    return url;
  }
}

export function TavusStage({
  conversationUrl,
  status,
  errorMessage,
  visible,
  onReady,
  onRetry,
}: TavusStageProps) {
  const handleLoad = useCallback(() => {
    onReady();
  }, [onReady]);

  const cleanUrl = useMemo(
    () => (conversationUrl ? applyDailyChromeSuppression(conversationUrl) : null),
    [conversationUrl]
  );
  const shouldMount = !!cleanUrl;
  const isLoading =
    status === "connecting" || (status === "connected" && shouldMount);
  const isReady = status === "ready";

  return (
    <div className="absolute inset-0 bg-[#1A1714] overflow-hidden">
      {/* Gradient placeholder is always in the back so the iframe can
          fade in over it once the customer engages. */}
      <div className="absolute inset-0 bg-linear-to-b from-zinc-900 via-zinc-800 to-black" />
      {shouldMount && (
        <iframe
          key={cleanUrl}
          src={cleanUrl ?? undefined}
          allow="camera; microphone; fullscreen; display-capture; autoplay"
          allowFullScreen
          className={`absolute inset-0 w-full h-full border-0 transition-opacity duration-300 ${
            visible ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          title="Erewhon Cashier"
          onLoad={handleLoad}
        />
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

      {/* Internal connection chip removed Apr 22 — AvatarOverlay in
          CashierApp already surfaces transient connecting/processing/
          error states; a second always-on chip here was the kind of
          "dashboard chrome" Temur wanted gone. */}
    </div>
  );
}
