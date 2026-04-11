"use client";

import { useCallback, useRef, useState } from "react";

type TTSStatus = "idle" | "loading" | "speaking";

interface UseCartesiaTTSReturn {
  status: TTSStatus;
  enqueue: (text: string) => void;
  stop: () => void;
}

export function useCartesiaTTS(): UseCartesiaTTSReturn {
  const [status, setStatus] = useState<TTSStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Array<Promise<string | null>>>([]);
  const processingRef = useRef(false);
  const genRef = useRef(0);

  const processQueue = useCallback(async (gen: number) => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0 && genRef.current === gen) {
      const urlPromise = queueRef.current.shift()!;
      const url = await urlPromise;

      if (genRef.current !== gen || !url) {
        if (url) URL.revokeObjectURL(url);
        continue;
      }

      setStatus("speaking");

      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;

        const done = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resolve();
        };

        audio.onended = done;
        audio.onerror = done;
        audio.onpause = done;
        audio.play().catch(done);
      });
    }

    if (genRef.current === gen) {
      processingRef.current = false;
      setStatus("idle");
    }
  }, []);

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
        processQueue(gen);
      }
    },
    [processQueue]
  );

  const stop = useCallback(() => {
    genRef.current++;
    processingRef.current = false;
    queueRef.current = [];

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setStatus("idle");
  }, []);

  return { status, enqueue, stop };
}
