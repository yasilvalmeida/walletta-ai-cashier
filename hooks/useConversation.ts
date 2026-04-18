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

interface UseConversationOptions {
  // True when Cartesia TTS should speak the response (fallback mode when
  // Tavus is disabled or unavailable). When false, the Tavus avatar is
  // the voice and Cartesia stays silent.
  cartesiaEnabled?: boolean;
  // True when transcripts come from Tavus's server-side STT (via the
  // webhook/SSE bridge) instead of our Deepgram pipeline. In that mode
  // we ignore Deepgram's onSpeechEnd so we don't double-transcribe —
  // the avatar's audio output would get captured by our mic and re-sent
  // to the chat, creating a feedback loop.
  tavusTranscriptsActive?: boolean;
}

export function useConversation(options: UseConversationOptions = {}) {
  const { cartesiaEnabled = false, tavusTranscriptsActive = false } = options;
  const cartesiaEnabledRef = useRef(cartesiaEnabled);
  cartesiaEnabledRef.current = cartesiaEnabled;
  const tavusTranscriptsActiveRef = useRef(tavusTranscriptsActive);
  tavusTranscriptsActiveRef.current = tavusTranscriptsActive;

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
  // True while draining the post-call Tavus transcript queue — in that
  // window we MUST NOT fire Cartesia because the avatar already spoke
  // those responses and we'd play a second voice on top of its goodbye.
  const externalSilentRef = useRef(false);

  const tts = useCartesiaTTS();
  const ttsRef = useRef(tts);
  ttsRef.current = tts;

  // When the receipt snapshot goes from set → null (customer tapped
  // "New Order"), wipe the chat history. Otherwise GPT-4o carries the
  // old conversation into the next order and may re-add items that are
  // already gone from the cart.
  const receiptSnapshot = useCartStore((s) => s.receiptSnapshot);
  const prevSnapshotRef = useRef(receiptSnapshot);
  useEffect(() => {
    const prev = prevSnapshotRef.current;
    prevSnapshotRef.current = receiptSnapshot;
    if (prev && !receiptSnapshot) {
      console.log("[Conversation] New order — resetting chat history");
      messagesRef.current = [];
      setTranscript("");
      setAssistantText("");
    }
  }, [receiptSnapshot]);

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

        await parseSSEStream(response, {
          onText: (delta) => {
            fullResponse += delta;
            setAssistantText(fullResponse);

            // Stream clauses to Cartesia TTS only when Tavus is off.
            // When Tavus is on the avatar speaks already; Cartesia would
            // layer a second voice on top.
            //
            // Clause-level boundary (. ! ? ; , —) instead of sentence-
            // only so the first audio chunk fires on the FIRST natural
            // pause, not the first full stop. Reduces perceived LLM→TTS
            // latency noticeably on multi-clause responses. We still
            // require a min-length of 18 chars so we don't produce
            // chunks like "Got," or "Sure,".
            sentenceBuffer += delta;
            const boundaryIdx = sentenceBuffer.search(/[.!?;,]\s/);
            if (boundaryIdx >= 18) {
              const chunk = sentenceBuffer
                .slice(0, boundaryIdx + 1)
                .trim();
              sentenceBuffer = sentenceBuffer.slice(boundaryIdx + 2);
              if (
                chunk &&
                cartesiaEnabledRef.current &&
                !externalSilentRef.current
              ) {
                ttsRef.current.enqueue(chunk);
              }
            }
          },
          onCartAction: (event: SSEEvent) => {
            if (event.type !== "cart_action") return;
            // Freeze the cart once the receipt snapshot exists. Without
            // this the LLM can emit stray add/remove actions during the
            // checkout response which would mutate `items` — but the
            // Receipt only reads from the frozen snapshot, so the QR
            // stays stable either way. Still, we drop the mutation so
            // the cart summary also stays consistent with what the user
            // is paying for.
            if (useCartStore.getState().receiptSnapshot) {
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

            const remaining = sentenceBuffer.trim();
            if (remaining && cartesiaEnabledRef.current) {
              ttsRef.current.enqueue(remaining);
            }
            sentenceBuffer = "";

            // Deferred to onDone so any cart_action events from this
            // turn have already applied to the store before we snapshot
            // the receipt. Also guarded against empty carts.
            const lower = userMessage.toLowerCase();
            const isFinalize =
              lower.includes("checkout") ||
              lower.includes("pay") ||
              lower.includes("that's all") ||
              lower.includes("that is all") ||
              lower === "done" ||
              lower.endsWith(" done") ||
              lower.startsWith("i'm done") ||
              lower.startsWith("i am done");
            if (isFinalize) {
              const cartHasItems =
                useCartStore.getState().items.length > 0;
              if (cartHasItems) {
                setReceiptReady(true);
              } else {
                console.log(
                  "[Chat] Finalize keyword matched but cart is empty — ignoring."
                );
              }
            }

            if (cartesiaEnabledRef.current && fullResponse.trim()) {
              // Cartesia queued — useEffect below waits for TTS idle
              // before flipping the phase back to listening.
              streamDoneRef.current = true;
              setStreamDoneSignal((s) => s + 1);
            } else {
              // Tavus mode (or empty response) — transition immediately.
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
        // Safari surfaces many transient network failures as "Load failed"
        // (TypeError). These are usually recoverable — the chat round-trip
        // can hang briefly while the iPad is talking to ngrok / when the
        // Deepgram WS + Tavus WebRTC + /api/chat SSE all share bandwidth.
        // We log it and fall back to "listening" instead of a scary red
        // banner so the user can just retry by speaking again.
        const msg = err instanceof Error ? err.message : "Chat request failed";
        const isTransient =
          msg === "Load failed" ||
          msg === "Failed to fetch" ||
          (err instanceof TypeError && /fetch|network/i.test(msg));
        console.error("[Chat] Error:", msg);
        if (isTransient) {
          setPhase("listening");
        } else {
          setError(msg);
          setPhase("error");
        }
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
        // Deepgram → /api/chat is the spec'd M2 pipeline for cart
        // updates in BOTH modes. No gating on Tavus status — Tavus's
        // tool-call / post-call transcript bridge was over-engineered
        // and unreliable. The avatar still speaks via its own pipeline;
        // our chat is just the source of truth for cart mutations, with
        // Cartesia TTS speaking the response only when Tavus isn't.
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

  // External entry point used by useTavusTranscripts to inject user
  // utterances that came from Tavus's server-side STT (via webhook +
  // SSE) instead of our Deepgram pipeline. Transcripts are queued and
  // sent to /api/chat strictly in order — sendToChat aborts any prior
  // fetch on entry, so running them in parallel would throw away every
  // turn except the last, which would leave the cart nearly empty.
  const externalQueueRef = useRef<string[]>([]);
  const externalProcessingRef = useRef(false);
  const processExternalQueue = useCallback(async () => {
    if (externalProcessingRef.current) return;
    externalProcessingRef.current = true;
    externalSilentRef.current = true;
    try {
      while (externalQueueRef.current.length > 0) {
        const next = externalQueueRef.current.shift();
        if (!next) continue;
        console.log("[Conversation] External transcript:", next);
        setTranscript("");
        await sendToChatRef.current(next);
      }
    } finally {
      externalSilentRef.current = false;
      externalProcessingRef.current = false;
    }
  }, []);

  const sendExternalTranscript = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      externalQueueRef.current.push(trimmed);
      void processExternalQueue();
    },
    [processExternalQueue]
  );

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
    sendExternalTranscript,
  };
}
