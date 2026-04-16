"use client";

import { useCallback, useRef, useState } from "react";

type TTSStatus = "idle" | "loading" | "speaking";

interface UseCartesiaTTSReturn {
  status: TTSStatus;
  enqueue: (text: string) => void;
  stop: () => void;
  unlock: () => void;
}

// Minimal valid WAV (36 bytes, 0 samples) used to prime the audio element
// inside a user gesture so iOS/iPad Safari will allow subsequent playback.
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export function useCartesiaTTS(): UseCartesiaTTSReturn {
  const [status, setStatus] = useState<TTSStatus>("idle");
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const queueRef = useRef<Array<Promise<string | null>>>([]);
  const processingRef = useRef(false);
  const genRef = useRef(0);

  const getAudioEl = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined") return null;
    if (!audioElRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioElRef.current = el;
    }
    return audioElRef.current;
  }, []);

  const processQueue = useCallback(
    async (gen: number) => {
      if (processingRef.current) return;
      processingRef.current = true;

      const audio = getAudioEl();

      while (queueRef.current.length > 0 && genRef.current === gen) {
        const urlPromise = queueRef.current.shift()!;
        const url = await urlPromise;

        if (genRef.current !== gen || !url || !audio) {
          if (url) URL.revokeObjectURL(url);
          continue;
        }

        setStatus("speaking");

        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            audio.onended = null;
            audio.onerror = null;
            audio.onpause = null;
            URL.revokeObjectURL(url);
            resolve();
          };

          audio.onended = done;
          audio.onerror = done;
          audio.onpause = done;
          audio.src = url;
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((err) => {
              console.warn("[TTS] Playback failed:", err);
              done();
            });
          }
        });
      }

      if (genRef.current === gen) {
        processingRef.current = false;
        setStatus("idle");
      }
    },
    [getAudioEl]
  );

  const enqueue = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      const gen = genRef.current;
      setStatus((prev) => (prev === "idle" ? "loading" : prev));

      const audioPromise = fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`TTS ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buf) => {
          const blob = new Blob([buf], { type: "audio/wav" });
          return URL.createObjectURL(blob);
        })
        .catch((err: unknown) => {
          console.error("[TTS] Fetch error:", err);
          return null;
        });

      queueRef.current.push(audioPromise);

      if (!processingRef.current) {
        void processQueue(gen);
      }
    },
    [processQueue]
  );

  const stop = useCallback(() => {
    genRef.current++;
    processingRef.current = false;
    queueRef.current = [];

    const audio = audioElRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      audio.pause();
    }

    setStatus("idle");
  }, []);

  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const audio = getAudioEl();
    if (!audio) return;
    unlockedRef.current = true;

    try {
      audio.muted = true;
      audio.src = SILENT_WAV_DATA_URI;
      const p = audio.play();
      const restore = () => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      };
      if (p && typeof p.then === "function") {
        p.then(restore).catch(() => {
          audio.muted = false;
        });
      } else {
        restore();
      }
    } catch {
      audio.muted = false;
    }
  }, [getAudioEl]);

  return { status, enqueue, stop, unlock };
}
