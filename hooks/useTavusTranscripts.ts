"use client";

import { useEffect, useRef } from "react";

interface TavusTranscriptEvent {
  conversationId: string;
  role: "user" | "replica" | "system";
  speech: string;
  timestamp: number;
}

interface UseTavusTranscriptsArgs {
  conversationId: string | null;
  // Fires for each user-side transcript. Keep the handler stable (ref
  // or useCallback) because a new identity will tear down and re-open
  // the EventSource.
  onUserTranscript: (speech: string) => void;
}

// Streams transcript events from our /api/tavus/events SSE endpoint,
// which is fed by Tavus webhook callbacks on conversation.utterance.
// Only fires onUserTranscript for the customer side — replica turns
// are dropped so we don't echo the avatar into our own chat pipeline.
export function useTavusTranscripts({
  conversationId,
  onUserTranscript,
}: UseTavusTranscriptsArgs): void {
  const handlerRef = useRef(onUserTranscript);
  handlerRef.current = onUserTranscript;

  useEffect(() => {
    if (!conversationId) return;
    if (typeof window === "undefined") return;

    const url = `/api/tavus/events?conversationId=${encodeURIComponent(
      conversationId
    )}`;
    const source = new EventSource(url);

    source.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as TavusTranscriptEvent;
        if (data.role !== "user") return;
        if (!data.speech.trim()) return;
        handlerRef.current(data.speech);
      } catch (err) {
        console.warn("[TavusTranscripts] bad event:", err);
      }
    };

    source.onerror = (err) => {
      console.warn("[TavusTranscripts] SSE error:", err);
    };

    return () => {
      source.close();
    };
  }, [conversationId]);
}
