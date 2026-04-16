"use client";

import { useCallback, useRef, useState, useMemo, useEffect } from "react";
import { useCartStore } from "@/store/cartStore";
import { useDeepgram } from "@/hooks/useDeepgram";
import { useVAD } from "@/hooks/useVAD";
import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";
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
  const [streamDoneSignal, setStreamDoneSignal] = useState(0);

  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);
  const items = useCartStore((s) => s.items);
  const setReceiptReady = useCartStore((s) => s.setReceiptReady);

  const messagesRef = useRef<ChatMessage[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamDoneRef = useRef(false);

  const tts = useCartesiaTTS();
  const ttsRef = useRef(tts);
  ttsRef.current = tts;

  // Transition to "listening" when both SSE stream and TTS queue are done
  useEffect(() => {
    if (tts.status === "idle" && streamDoneRef.current) {
      streamDoneRef.current = false;
      setPhase("listening");
    }
  }, [tts.status, streamDoneSignal]);

  const sendToChat = useCallback(
    async (userMessage: string) => {
      console.log("[Chat] Sending:", userMessage);
      ttsRef.current.stop();
      streamDoneRef.current = false;
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
        let sentenceBuffer = "";

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

            // Stream sentences to TTS as they complete
            sentenceBuffer += delta;
            const boundaryIdx = sentenceBuffer.search(/[.!?]\s/);
            if (boundaryIdx >= 0) {
              const sentence = sentenceBuffer
                .slice(0, boundaryIdx + 1)
                .trim();
              sentenceBuffer = sentenceBuffer.slice(boundaryIdx + 2);
              if (sentence) {
                ttsRef.current.enqueue(sentence);
              }
            }
          },
          onCartAction: (event: SSEEvent) => {
            if (event.type !== "cart_action") return;
            // Freeze the cart once the receipt is ready. Without this the
            // LLM can emit stray add/remove actions during the checkout
            // response which in turn mutates `items`, invalidates the
            // Receipt's memoised qrData, and causes the QR to redraw on
            // every SSE frame.
            if (useCartStore.getState().receiptReady) {
              console.log(
                "[Chat] Ignoring cart action after receipt is ready:",
                event.action
              );
              return;
            }
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
            // Flush remaining sentence buffer to TTS
            const remaining = sentenceBuffer.trim();
            if (remaining) {
              ttsRef.current.enqueue(remaining);
              sentenceBuffer = "";
            }

            if (fullResponse.trim()) {
              // TTS was enqueued — useEffect handles phase transition
              streamDoneRef.current = true;
              setStreamDoneSignal((s) => s + 1);
            } else {
              setPhase("listening");
            }
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
        // Guard against echo: if the avatar is currently speaking, the
        // mic is almost certainly picking up its own voice (iOS echo
        // cancellation is too weak to suppress it reliably). Refusing
        // to barge-in here lets TTS finish instead of being killed on
        // the very first speaker-triggered VAD poll.
        const s = ttsRef.current.status;
        if (s === "speaking" || s === "loading") return;
        ttsRef.current.stop();
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
        // Same echo guard — Deepgram may also transcribe the avatar's
        // voice. Showing that echo as a user transcript, or routing it
        // back into the chat, would feed the model its own output.
        const s = ttsRef.current.status;
        if (s === "speaking" || s === "loading") return;
        setTranscript(text);
        if (isFinal) {
          setPhase("listening");
        }
      },
      onSpeechEnd: (fullTranscript: string) => {
        const s = ttsRef.current.status;
        if (s === "speaking" || s === "loading") return;
        if (fullTranscript.trim()) {
          console.log(
            "[Conversation] Speech ended, sending to chat:",
            fullTranscript.trim()
          );
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

    // iOS/iPad Safari blocks audio playback until the element has been
    // played once inside a user gesture. This call MUST stay synchronous
    // (before the first await) so it runs in the click handler's stack.
    ttsRef.current.unlock();

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
    ttsRef.current.stop();
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
    ttsStatus: tts.status,
    start,
    stop,
  };
}
