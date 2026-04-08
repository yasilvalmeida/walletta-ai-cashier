"use client";

import { useCallback, useRef, useState, useEffect } from "react";

interface DeepgramResult {
  type?: string;
  channel?: {
    alternatives: Array<{
      transcript: string;
      confidence: number;
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
}

interface UseDeepgramOptions {
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onSpeechEnd: (fullTranscript: string) => void;
  onError?: (error: Error) => void;
}

type DeepgramStatus = "idle" | "connecting" | "connected" | "error";

export function useDeepgram(options: UseDeepgramOptions) {
  const [status, setStatus] = useState<DeepgramStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const transcriptRef = useRef("");
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Use refs for callbacks to avoid stale closures in WebSocket handlers
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const startAudioCapture = useCallback((stream: MediaStream, ws: WebSocket) => {
    // Browser may not support 16kHz — create at default rate and resample
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const nativeSampleRate = audioContext.sampleRate;

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Resample to 16kHz if needed
      let samples: Float32Array;
      if (nativeSampleRate !== 16000) {
        const ratio = nativeSampleRate / 16000;
        const newLength = Math.round(inputData.length / ratio);
        samples = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
          samples[i] = inputData[Math.round(i * ratio)];
        }
      } else {
        samples = inputData;
      }

      // Convert float32 to int16 PCM
      const pcm16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      ws.send(pcm16.buffer);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }, []);

  const connect = useCallback(async (stream: MediaStream) => {
    setStatus("connecting");
    transcriptRef.current = "";
    mediaStreamRef.current = stream;

    try {
      const res = await fetch("/api/deepgram/token", { method: "POST" });
      if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
      const { key } = (await res.json()) as { key: string };

      const wsUrl = new URL("wss://api.deepgram.com/v1/listen");
      wsUrl.searchParams.set("model", "nova-2");
      wsUrl.searchParams.set("language", "en");
      wsUrl.searchParams.set("smart_format", "true");
      wsUrl.searchParams.set("interim_results", "true");
      wsUrl.searchParams.set("endpointing", "800");
      wsUrl.searchParams.set("vad_events", "true");
      wsUrl.searchParams.set("encoding", "linear16");
      wsUrl.searchParams.set("sample_rate", "16000");
      wsUrl.searchParams.set("channels", "1");

      const ws = new WebSocket(wsUrl.toString(), ["token", key]);

      ws.onopen = () => {
        console.log("[Deepgram] Connected");
        setStatus("connected");
        startAudioCapture(stream, ws);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as DeepgramResult;

          // Skip non-result messages (metadata, etc.)
          if (!data.channel?.alternatives) return;

          const transcript = data.channel.alternatives[0]?.transcript ?? "";

          // Deepgram can send speech_final with an empty transcript
          // (just a "done speaking" signal). Handle it before the
          // empty-transcript guard so onSpeechEnd always fires.
          if (data.is_final && data.speech_final) {
            if (transcript) {
              transcriptRef.current += (transcriptRef.current ? " " : "") + transcript;
              optionsRef.current.onTranscript(transcriptRef.current, true);
            }
            const full = transcriptRef.current.trim();
            console.log("[Deepgram] Speech complete:", full);
            if (full) {
              optionsRef.current.onSpeechEnd(full);
            }
            transcriptRef.current = "";
            return;
          }

          if (!transcript) return;

          console.log("[Deepgram]", data.is_final ? "FINAL:" : "interim:", transcript);

          if (data.is_final) {
            transcriptRef.current += (transcriptRef.current ? " " : "") + transcript;
            optionsRef.current.onTranscript(transcriptRef.current, true);
          } else {
            const interim = transcriptRef.current
              ? transcriptRef.current + " " + transcript
              : transcript;
            optionsRef.current.onTranscript(interim, false);
          }
        } catch {
          // Skip non-JSON messages
        }
      };

      ws.onerror = (e) => {
        console.error("[Deepgram] WebSocket error:", e);
        setStatus("error");
        optionsRef.current.onError?.(new Error("Deepgram WebSocket error"));
      };

      ws.onclose = (e) => {
        console.log("[Deepgram] Closed:", e.code, e.reason);
        setStatus("idle");
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[Deepgram] Connection failed:", err);
      setStatus("error");
      optionsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [startAudioCapture]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    transcriptRef.current = "";
    setStatus("idle");
  }, []);

  return { status, connect, disconnect };
}
