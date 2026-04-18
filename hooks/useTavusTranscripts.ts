"use client";

import { useEffect, useRef } from "react";
import type { Modifier } from "@/lib/schemas";

export interface TavusCartActionPayload {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  size?: string;
  modifiers?: Modifier[];
}

type TavusChannelEvent =
  | {
      kind: "transcript";
      conversationId: string;
      role: "user" | "replica" | "system";
      speech: string;
      timestamp: number;
    }
  | {
      kind: "cart_action";
      conversationId: string;
      action: "add" | "remove";
      payload: TavusCartActionPayload;
      timestamp: number;
    }
  | {
      kind: "finalize";
      conversationId: string;
      timestamp: number;
    };

interface UseTavusTranscriptsArgs {
  conversationId: string | null;
  onUserTranscript?: (speech: string) => void;
  onCartAction?: (
    action: "add" | "remove",
    payload: TavusCartActionPayload
  ) => void;
  onFinalize?: () => void;
}

// Streams Tavus events over SSE from /api/tavus/events. Three kinds of
// events flow through one channel:
//  - transcript  — diagnostic / fallback; user-side speech
//  - cart_action — avatar called add_to_cart or remove_from_cart
//  - finalize    — avatar called finalize_order (customer is done)
// Callbacks are kept in refs so a parent can pass inline handlers
// without thrashing the EventSource subscription.
export function useTavusTranscripts({
  conversationId,
  onUserTranscript,
  onCartAction,
  onFinalize,
}: UseTavusTranscriptsArgs): void {
  const transcriptRef = useRef(onUserTranscript);
  const cartActionRef = useRef(onCartAction);
  const finalizeRef = useRef(onFinalize);
  transcriptRef.current = onUserTranscript;
  cartActionRef.current = onCartAction;
  finalizeRef.current = onFinalize;

  useEffect(() => {
    if (!conversationId) return;
    if (typeof window === "undefined") return;

    const url = `/api/tavus/events?conversationId=${encodeURIComponent(
      conversationId
    )}`;
    const source = new EventSource(url);

    source.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as TavusChannelEvent;
        if (data.kind === "transcript") {
          if (data.role !== "user") return;
          if (!data.speech.trim()) return;
          transcriptRef.current?.(data.speech);
          return;
        }
        if (data.kind === "cart_action") {
          cartActionRef.current?.(data.action, data.payload);
          return;
        }
        if (data.kind === "finalize") {
          finalizeRef.current?.();
          return;
        }
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
