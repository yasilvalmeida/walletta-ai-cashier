"use client";

import { useCallback, useEffect, useRef } from "react";
import DailyIframe, {
  type DailyCall,
  type DailyEventObjectParticipant,
  type DailyEventObjectTrack,
  type DailyEventObjectFatalError,
  type DailyEventObjectNonFatalError,
} from "@daily-co/daily-js";

interface DailyStageProps {
  conversationUrl: string | null;
  status: "idle" | "connecting" | "connected" | "ready" | "error";
  errorMessage: string | null;
  // When false the call stays joined (so the WebRTC handshake can run
  // in the background) but the <video> stays opacity-0 so we never
  // show a blank/loading frame to the customer pre-interaction.
  visible: boolean;
  onReady: () => void;
  onRetry: () => void;
}

// Headless Daily integration: replaces the old <iframe src={conversationUrl}>
// that rendered the full Daily.co prebuilt meeting UI (toolbar, self-view,
// "N people in call" banner, speaker-view toggle — all visible on iPad
// per Temur's Apr 23 feedback). Daily prebuilt URL params DO NOT hide
// those controls when embedded as a raw iframe; they only work via the
// daily-js SDK. So we drop the iframe entirely and drive the call from
// a DailyCall object, attaching the remote replica's video + audio tracks
// to our own <video> and <audio> elements. Zero Daily chrome.
//
// We explicitly do NOT publish the user's camera or mic into the Daily
// call — Deepgram owns the mic (see hooks/useDeepgram.ts). Tavus's server
// side still runs its own STT/LLM/TTS based on... nothing from us in this
// setup; the replica greets + responds driven entirely by Tavus's internal
// pipeline. That's fine — our /api/chat path still drives cart mutations
// via Deepgram independently (see hooks/useConversation.ts).
export function DailyStage({
  conversationUrl,
  status,
  errorMessage,
  visible,
  onReady,
  onRetry,
}: DailyStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callRef = useRef<DailyCall | null>(null);
  const joinedUrlRef = useRef<string | null>(null);
  const readySignaledRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const attachTrack = useCallback(
    (event: DailyEventObjectTrack) => {
      const participant = event.participant;
      if (!participant || participant.local) return;
      const track = event.track;
      if (!track) return;

      if (event.type === "video" && videoRef.current) {
        videoRef.current.srcObject = new MediaStream([track]);
        // iOS Safari requires playsInline + muted=true for autoplay on
        // a <video> element. Audio lives on a separate <audio> element
        // (which plays on user gesture). Marking the video muted avoids
        // double-audio with the <audio> element that also carries it.
        videoRef.current.muted = true;
        void videoRef.current.play().catch(() => {
          /* retried on user gesture via the visible prop transition */
        });
        if (!readySignaledRef.current) {
          readySignaledRef.current = true;
          onReadyRef.current();
        }
      } else if (event.type === "audio" && audioRef.current) {
        audioRef.current.srcObject = new MediaStream([track]);
        void audioRef.current.play().catch(() => {
          /* will retry on first user gesture */
        });
      }
    },
    []
  );

  // Set up the call object once, and join/leave based on conversationUrl.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!conversationUrl) return;
    if (joinedUrlRef.current === conversationUrl) return;

    let cancelled = false;

    const setup = async () => {
      // Tear down any prior call (e.g. reconnect with a new conversation
      // URL after "New Order").
      if (callRef.current) {
        try {
          await callRef.current.leave();
        } catch {
          // already left
        }
        try {
          callRef.current.destroy();
        } catch {
          // already destroyed
        }
        callRef.current = null;
      }
      readySignaledRef.current = false;

      const call = DailyIframe.createCallObject({
        // Publish the user's mic into the Daily room: Tavus's backend
        // needs to hear the customer to run its own STT/LLM/TTS that
        // drives the replica. We do NOT publish video (camera). Daily
        // and Deepgram both call getUserMedia; on iOS Safari they
        // share the underlying track, so the mic permission prompt
        // only appears once.
        audioSource: true,
        videoSource: false,
        subscribeToTracksAutomatically: true,
      });
      if (cancelled) {
        try {
          call.destroy();
        } catch {
          /* ignore */
        }
        return;
      }
      callRef.current = call;

      call.on("track-started", attachTrack);
      call.on("participant-joined", (ev: DailyEventObjectParticipant) => {
        // Replica's existing tracks may already be playable at join
        // time; attach them immediately rather than waiting for the
        // next track-started event which won't fire.
        const p = ev.participant;
        if (p.local) return;
        const videoTrack = p.tracks.video?.persistentTrack ?? null;
        const audioTrack = p.tracks.audio?.persistentTrack ?? null;
        if (videoTrack) {
          attachTrack({
            action: "track-started",
            type: "video",
            track: videoTrack,
            participant: p,
          } as DailyEventObjectTrack);
        }
        if (audioTrack) {
          attachTrack({
            action: "track-started",
            type: "audio",
            track: audioTrack,
            participant: p,
          } as DailyEventObjectTrack);
        }
      });
      call.on("left-meeting", () => {
        joinedUrlRef.current = null;
        readySignaledRef.current = false;
      });
      call.on("error", (ev: DailyEventObjectFatalError) => {
        console.error("[Daily] fatal error:", ev.errorMsg);
      });
      call.on("nonfatal-error", (ev: DailyEventObjectNonFatalError) => {
        console.warn("[Daily] nonfatal error:", ev.type, ev.details);
      });

      try {
        await call.join({ url: conversationUrl });
        if (cancelled) {
          try {
            await call.leave();
          } catch {
            /* ignore */
          }
          return;
        }
        joinedUrlRef.current = conversationUrl;
      } catch (err) {
        console.error("[Daily] join failed:", err);
      }
    };

    void setup();

    return () => {
      cancelled = true;
    };
  }, [conversationUrl, attachTrack]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (callRef.current) {
        try {
          void callRef.current.leave();
        } catch {
          /* ignore */
        }
        try {
          callRef.current.destroy();
        } catch {
          /* ignore */
        }
        callRef.current = null;
      }
    };
  }, []);

  // When the customer taps the mic (the visible prop flips true) we
  // retry .play() in case iOS blocked autoplay until gesture. Safari
  // returns a rejected promise from .play() when autoplay is blocked;
  // calling it again inside the gesture handler clears the block.
  useEffect(() => {
    if (!visible) return;
    void audioRef.current?.play().catch(() => {});
    void videoRef.current?.play().catch(() => {});
  }, [visible]);

  const isLoading = status === "connecting" || status === "connected";
  const isReady = status === "ready";

  return (
    <div className="absolute inset-0 bg-[#1A1714] overflow-hidden">
      {/* Gradient placeholder behind the video so the transition from
          black-screen → live-avatar is a fade rather than a pop. */}
      <div className="absolute inset-0 bg-linear-to-b from-zinc-900 via-zinc-800 to-black" />

      <video
        ref={videoRef}
        autoPlay
        playsInline
        // object-cover fills the stage with the replica's face, no
        // letterboxing / black bars — directly fixes Temur's "massive
        // black borders" complaint from IMG_9313/9314.
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          visible && isReady ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

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
    </div>
  );
}
