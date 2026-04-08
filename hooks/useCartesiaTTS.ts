"use client";

import { useCallback, useRef, useState } from "react";

type TTSStatus = "idle" | "loading" | "speaking" | "error";

interface UseCartesiaTTSReturn {
  status: TTSStatus;
  speak: (text: string) => Promise<void>;
  stop: () => void;
}

export function useCartesiaTTS(): UseCartesiaTTSReturn {
  const [status, setStatus] = useState<TTSStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }

    setStatus("idle");
  }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      stop();

      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        setStatus("error");
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      return new Promise<void>((resolve, reject) => {
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          urlRef.current = null;
          audioRef.current = null;
          setStatus("idle");
          resolve();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          urlRef.current = null;
          audioRef.current = null;
          setStatus("error");
          reject(new Error("Audio playback failed"));
        };

        setStatus("speaking");
        audio.play().catch((err: unknown) => {
          URL.revokeObjectURL(url);
          urlRef.current = null;
          audioRef.current = null;
          setStatus("error");
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    },
    [stop]
  );

  return { status, speak, stop };
}
