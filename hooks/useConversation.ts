"use client";

import { useCallback, useRef, useState, useMemo, useEffect } from "react";
import { useCartStore } from "@/store/cartStore";
import { useDeepgram } from "@/hooks/useDeepgram";
import { useVAD } from "@/hooks/useVAD";
import { useCartesiaTTS } from "@/hooks/useCartesiaTTS";
import { parseSSEStream } from "@/lib/sse";
import { telemetry } from "@/lib/telemetry";
import { isAvatarSpeaking } from "@/lib/tavusPresence";
import { fillersFor, pickFiller } from "@/lib/fillers";
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
  // the voice and Cartesia stays silent. The echo guard that suppresses
  // Deepgram while the avatar speaks lives in lib/tavusPresence and is
  // fed by CashierApp's useTavusTranscripts subscription — no extra
  // flag is needed here.
  cartesiaEnabled?: boolean;
}

export function useConversation(options: UseConversationOptions = {}) {
  const { cartesiaEnabled = false } = options;
  const cartesiaEnabledRef = useRef(cartesiaEnabled);
  cartesiaEnabledRef.current = cartesiaEnabled;

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

  // Pre-synthesized filler acknowledgments per language, keyed by the
  // exact filler string (so we can cache multiple phrases per language
  // and pick randomly at turn-time). Populated lazily the first time a
  // language is seen — English on mount, others after detection.
  const fillerCacheRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const fillerInFlightRef = useRef<Set<string>>(new Set());

  const ensureFillersForLanguage = useCallback(
    async (language: string) => {
      const phrases = fillersFor(language);
      for (const phrase of phrases) {
        const key = `${language}:${phrase}`;
        if (fillerCacheRef.current.has(key)) continue;
        if (fillerInFlightRef.current.has(key)) continue;
        fillerInFlightRef.current.add(key);
        const buf = await ttsRef.current.preloadBuffer(phrase, language);
        fillerInFlightRef.current.delete(key);
        if (buf) fillerCacheRef.current.set(key, buf);
      }
    },
    []
  );

  // Pre-cache English fillers on mount so the very first turn gets the
  // perceived-latency mask (not just turns 2+).
  useEffect(() => {
    void ensureFillersForLanguage("en");
  }, [ensureFillersForLanguage]);

  const playFillerForLanguage = useCallback((language: string | undefined) => {
    const lang = language ?? "en";
    const phrase = pickFiller(lang);
    const key = `${lang}:${phrase}`;
    const buf = fillerCacheRef.current.get(key);
    if (!buf) return false;
    // decodeAudioData detaches its input in some Safari versions, so
    // we decode against a fresh copy and keep the original in cache.
    ttsRef.current.enqueueBuffer(buf.slice(0));
    return true;
  }, []);

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
      telemetry.mark("audioDone");
      telemetry.endTurn();
    }
  }, [tts.status, streamDoneSignal]);

  // Stores the last known detected language so we can keep using it
  // for external (Tavus-initiated) transcripts which don't carry
  // language metadata, and so mid-turn follow-ups stay consistent.
  const lastLanguageRef = useRef<string | undefined>(undefined);
  // Pair (language, turnIndex) so subscribers can react each turn even
  // when the detected language stays the same ("es" → "es" still fires
  // the downstream effect because turnIndex incremented).
  const [turnIndex, setTurnIndex] = useState(0);
  const [detectedLanguage, setDetectedLanguage] = useState<string | undefined>(
    undefined
  );

  const sendToChat = useCallback(
    async (userMessage: string, language?: string) => {
      console.log("[Chat] Sending:", userMessage, language ? `(${language})` : "");
      ttsRef.current.stop();
      streamDoneRef.current = false;
      setPhase("processing");
      setAssistantText("");

      if (language) {
        lastLanguageRef.current = language;
        setDetectedLanguage(language);
        // Fire-and-forget cache warm for the newly-detected language so
        // the NEXT turn gets the filler mask (this turn may miss it).
        void ensureFillersForLanguage(language);
      }
      setTurnIndex((i) => i + 1);
      const activeLanguage = lastLanguageRef.current;

      telemetry.setMode(cartesiaEnabledRef.current ? "cartesia" : "tavus");
      telemetry.mark("chatRequestSent");

      // Sub-400ms perceived: fire a pre-cached filler the instant we
      // receive the transcript. Plays within ~50ms via the TTS queue;
      // the real LLM response queues behind it and picks up naturally
      // when tokens start streaming. Cartesia-only — in Tavus mode the
      // avatar owns the voice and layering a second voice would clash.
      if (cartesiaEnabledRef.current) {
        playFillerForLanguage(activeLanguage);
      }

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
            language: activeLanguage,
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
            telemetry.mark("llmFirstToken");
            fullResponse += delta;
            setAssistantText(fullResponse);

            // Stream clauses to Cartesia TTS only when Tavus is off.
            // When Tavus is on the avatar speaks already; Cartesia would
            // layer a second voice on top.
            //
            // Clause-level boundary (. ! ? ; , —) instead of sentence-
            // only so the first audio chunk fires on the FIRST natural
            // pause, not the first full stop. Min-length dropped from
            // 18 → 10 chars (Apr 22) so short acknowledgments like
            // "Got it — one latte," start speaking on the first comma
            // instead of waiting for the full sentence.
            sentenceBuffer += delta;
            const boundaryIdx = sentenceBuffer.search(/[.!?;,]\s/);
            if (boundaryIdx >= 10) {
              const chunk = sentenceBuffer
                .slice(0, boundaryIdx + 1)
                .trim();
              sentenceBuffer = sentenceBuffer.slice(boundaryIdx + 2);
              if (chunk && cartesiaEnabledRef.current) {
                ttsRef.current.enqueue(chunk, activeLanguage);
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
            telemetry.mark("llmDone");
            console.log("[Chat] Done. Response:", fullResponse);
            if (fullResponse) {
              messagesRef.current.push({
                role: "assistant",
                content: fullResponse,
              });
            }

            const remaining = sentenceBuffer.trim();
            if (remaining && cartesiaEnabledRef.current) {
              ttsRef.current.enqueue(remaining, activeLanguage);
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
              telemetry.endTurn();
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
    [addItem, removeItem, setReceiptReady, ensureFillersForLanguage, playFillerForLanguage]
  );

  // Stable refs for hook callbacks to prevent unnecessary re-renders
  const sendToChatRef = useRef(sendToChat);
  sendToChatRef.current = sendToChat;

  const vadOptions = useMemo(
    () => ({
      onSpeechStart: () => {
        // Two echo guards: (1) Cartesia is playing our own TTS; (2) the
        // Tavus avatar is audibly speaking. In either case iOS echo
        // cancellation is too weak to fully suppress the speaker through
        // the mic, so we treat VAD "speech start" as likely-spurious and
        // skip the barge-in.
        const s = ttsRef.current.status;
        if (s === "speaking" || s === "loading") return;
        if (isAvatarSpeaking()) return;
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
        // Two echo guards: (1) Cartesia is actively playing our TTS; (2)
        // the Tavus avatar is audibly speaking in the room. Deepgram
        // transcribes anything the mic picks up — without these guards
        // the avatar's own voice comes back to us as a "user transcript"
        // and feeds the chat pipeline its own output.
        const s = ttsRef.current.status;
        if (s === "speaking" || s === "loading") return;
        if (isAvatarSpeaking()) return;
        setTranscript(text);
        if (isFinal) {
          setPhase("listening");
        }
      },
      onSpeechEnd: (fullTranscript: string, language?: string) => {
        // Deepgram → /api/chat drives cart mutations in both Cartesia
        // and Tavus modes. In Tavus mode, the avatar has its own
        // independent voice pipeline — we MUST drop this turn if the
        // avatar is still talking, because what Deepgram "heard" is
        // almost certainly the avatar echoing off the iPad speakers.
        const s = ttsRef.current.status;
        if (s === "speaking" || s === "loading") return;
        if (isAvatarSpeaking()) {
          console.log(
            "[Conversation] Dropping transcript — avatar is speaking:",
            fullTranscript.trim().slice(0, 60)
          );
          return;
        }
        if (fullTranscript.trim()) {
          console.log(
            "[Conversation] Speech ended, sending to chat:",
            fullTranscript.trim(),
            language ? `[${language}]` : ""
          );
          setTranscript("");
          sendToChatRef.current(fullTranscript.trim(), language);
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
    detectedLanguage,
    turnIndex,
    start,
    stop,
  };
}
