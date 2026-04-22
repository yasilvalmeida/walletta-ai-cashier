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
  // Array of active conversation ids to subscribe to. Usually 1-2:
  // the live conversation + the previous one still in its post-call
  // transcript grace window. Managing both in a single hook invocation
  // avoids the close/reopen gap a pair of hook calls would create.
  conversationIds: string[];
  onUserTranscript?: (speech: string) => void;
  // Fires every time Tavus publishes a replica transcript chunk (the
  // avatar's own speech). Used as a proof-of-life signal for the
  // Deepgram echo guard — receivers should assume the avatar is still
  // audibly speaking for ~1.5s past the last such event.
  onReplicaTranscript?: (speech: string) => void;
  onCartAction?: (
    action: "add" | "remove",
    payload: TavusCartActionPayload
  ) => void;
  onFinalize?: () => void;
}

export function useTavusTranscripts({
  conversationIds,
  onUserTranscript,
  onReplicaTranscript,
  onCartAction,
  onFinalize,
}: UseTavusTranscriptsArgs): void {
  const transcriptRef = useRef(onUserTranscript);
  const replicaRef = useRef(onReplicaTranscript);
  const cartActionRef = useRef(onCartAction);
  const finalizeRef = useRef(onFinalize);
  transcriptRef.current = onUserTranscript;
  replicaRef.current = onReplicaTranscript;
  cartActionRef.current = onCartAction;
  finalizeRef.current = onFinalize;

  // Stable key so we only re-run the effect when the ACTUAL set of ids
  // changes, not on every render.
  const key = conversationIds.filter(Boolean).sort().join(",");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = key ? key.split(",") : [];
    const sources = new Map<string, EventSource>();

    const onMessage = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data) as TavusChannelEvent;
        // Defense-in-depth: SSE is already filtered by conversationId
        // via URL param, but the server pub/sub stores a backlog per
        // id. If a stale id somehow re-enters our subscription set the
        // match check keeps its events out of the live handlers.
        if (!ids.includes(data.conversationId)) return;
        if (data.kind === "transcript") {
          if (!data.speech.trim()) return;
          if (data.role === "replica") {
            replicaRef.current?.(data.speech);
            return;
          }
          if (data.role !== "user") return;
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

    for (const id of ids) {
      const url = `/api/tavus/events?conversationId=${encodeURIComponent(id)}`;
      const source = new EventSource(url);
      source.onmessage = onMessage;
      source.onerror = (err) => {
        console.warn("[TavusTranscripts] SSE error for", id, err);
      };
      sources.set(id, source);
    }

    return () => {
      for (const s of sources.values()) s.close();
    };
  }, [key]);
}
