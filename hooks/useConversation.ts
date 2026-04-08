"use client";

import { useCallback, useRef, useState, useMemo } from "react";
import { useCartStore } from "@/store/cartStore";
import { useDeepgram } from "@/hooks/useDeepgram";
import { useVAD } from "@/hooks/useVAD";
import { parseSSEStream } from "@/lib/sse";
import type { OrderItem, SSEEvent } from "@/lib/schemas";

type ConversationPhase =
  | "idle"
  | "listening"
  | "processing"
  | "responding"
  | "error";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function useConversation() {
  const [phase, setPhase] = useState<ConversationPhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);
  const items = useCartStore((s) => s.items);
  const setReceiptReady = useCartStore((s) => s.setReceiptReady);

  const messagesRef = useRef<ChatMessage[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendToChat = useCallback(
    async (userMessage: string) => {
      console.log("[Chat] Sending:", userMessage);
      setPhase("processing");
      setAssistantText("");

      messagesRef.current.push({ role: "user", content: userMessage });

      const cartContext: OrderItem[] = useCartStore.getState().items;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messagesRef.current,
            cartContext,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Chat failed: ${response.status}`);
        }

        setPhase("responding");
        let fullResponse = "";

        const lower = userMessage.toLowerCase();
        if (
          lower.includes("checkout") ||
          lower.includes("pay") ||
          lower.includes("done") ||
          lower.includes("that's all") ||
          lower.includes("that is all")
        ) {
          setReceiptReady(true);
        }

        await parseSSEStream(response, {
          onText: (delta) => {
            fullResponse += delta;
            setAssistantText(fullResponse);
          },
          onCartAction: (event: SSEEvent) => {
            if (event.type !== "cart_action") return;
            console.log("[Chat] Cart action:", event.action, event.payload);
            if (event.action === "add_to_cart") {
              addItem(event.payload);
            } else if (event.action === "remove_from_cart") {
              removeItem(event.payload.product_id);
            }
          },
          onDone: () => {
            console.log("[Chat] Done. Response:", fullResponse);
            if (fullResponse) {
              messagesRef.current.push({
                role: "assistant",
                content: fullResponse,
              });
            }
            setPhase("listening");
          },
          onError: (err) => {
            console.error("[Chat] Stream error:", err);
            setError(err.message);
            setPhase("error");
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Chat request failed";
        console.error("[Chat] Error:", msg);
        setError(msg);
        setPhase("error");
      }
    },
    [addItem, removeItem, setReceiptReady]
  );

  // Stable refs for hook callbacks to prevent unnecessary re-renders
  const sendToChatRef = useRef(sendToChat);
  sendToChatRef.current = sendToChat;

  const vadOptions = useMemo(
    () => ({
      onSpeechStart: () => {
        setPhase("listening");
      },
      onSpeechEnd: () => {
        // Deepgram handles end-of-speech via speech_final
      },
    }),
    []
  );

  const deepgramOptions = useMemo(
    () => ({
      onTranscript: (text: string, isFinal: boolean) => {
        setTranscript(text);
        if (isFinal) {
          setPhase("listening");
        }
      },
      onSpeechEnd: (fullTranscript: string) => {
        if (fullTranscript.trim()) {
          console.log("[Conversation] Speech ended, sending to chat:", fullTranscript.trim());
          setTranscript("");
          sendToChatRef.current(fullTranscript.trim());
        }
      },
      onError: (err: Error) => {
        setError(err.message);
        setPhase("error");
      },
    }),
    []
  );

  const vad = useVAD(vadOptions);
  const deepgram = useDeepgram(deepgramOptions);

  const start = useCallback(async () => {
    setError(null);
    setPhase("idle");
    console.log("[Conversation] Starting...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      console.log("[Conversation] Mic access granted");
      mediaStreamRef.current = stream;

      vad.startListening(stream);
      await deepgram.connect(stream);

      setPhase("listening");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Microphone access denied";
      console.error("[Conversation] Start failed:", msg);
      setError(msg);
      setPhase("error");
    }
  }, [vad, deepgram]);

  const stop = useCallback(() => {
    console.log("[Conversation] Stopping");
    abortRef.current?.abort();
    vad.stopListening();
    deepgram.disconnect();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    setPhase("idle");
    setTranscript("");
  }, [vad, deepgram]);

  return {
    phase,
    transcript,
    assistantText,
    error,
    items,
    isListening: vad.isListening,
    isSpeaking: vad.isSpeaking,
    volume: vad.volume,
    deepgramStatus: deepgram.status,
    start,
    stop,
  };
}
