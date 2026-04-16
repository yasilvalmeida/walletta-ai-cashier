"use client";

import { useCallback, useRef, useState } from "react";

type TTSStatus = "idle" | "loading" | "speaking";

interface UseCartesiaTTSReturn {
  status: TTSStatus;
  enqueue: (text: string) => void;
  stop: () => void;
  unlock: () => void;
}

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export function useCartesiaTTS(): UseCartesiaTTSReturn {
  const [status, setStatus] = useState<TTSStatus>("idle");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<Array<Promise<ArrayBuffer | null>>>([]);
  const processingRef = useRef(false);
  const genRef = useRef(0);
  const unlockedRef = useRef(false);
  const currentDoneRef = useRef<(() => void) | null>(null);

  const getAudioCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const w = window as WebkitAudioWindow;
      const Ctor = window.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }, []);

  const decodeBuffer = useCallback(
    (ctx: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> =>
      new Promise((resolve) => {
        // Safari's decodeAudioData prefers the callback form; also slice()
        // to give it a dedicated ArrayBuffer (some impls detach on decode).
        try {
          ctx.decodeAudioData(
            arrayBuffer.slice(0),
            (decoded) => resolve(decoded),
            (err) => {
              console.warn("[TTS] decodeAudioData failed:", err);
              resolve(null);
            }
          );
        } catch (err) {
          console.warn("[TTS] decodeAudioData threw:", err);
          resolve(null);
        }
      }),
    []
  );

  const processQueue = useCallback(
    async (gen: number) => {
      if (processingRef.current) return;
      processingRef.current = true;

      const ctx = getAudioCtx();

      while (queueRef.current.length > 0 && genRef.current === gen) {
        const bufferPromise = queueRef.current.shift()!;
        const arrayBuffer = await bufferPromise;

        if (genRef.current !== gen || !arrayBuffer || !ctx) continue;

        if (ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch {
            // If resume fails, let the decode/play attempt surface a warning.
          }
        }

        const audioBuffer = await decodeBuffer(ctx, arrayBuffer);
        if (!audioBuffer || genRef.current !== gen) continue;

        setStatus("speaking");

        await new Promise<void>((resolve) => {
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          currentSourceRef.current = source;

          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            try {
              source.disconnect();
            } catch {
              // already disconnected
            }
            if (currentSourceRef.current === source) {
              currentSourceRef.current = null;
            }
            currentDoneRef.current = null;
            resolve();
          };
          currentDoneRef.current = done;
          source.onended = done;

          try {
            source.start();
          } catch (err) {
            console.warn("[TTS] source.start failed:", err);
            done();
          }
        });
      }

      if (genRef.current === gen) {
        processingRef.current = false;
        setStatus("idle");
      }
    },
    [getAudioCtx, decodeBuffer]
  );

  const enqueue = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      const gen = genRef.current;
      setStatus((prev) => (prev === "idle" ? "loading" : prev));

      const bufferPromise = fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`TTS ${res.status}`);
          return res.arrayBuffer();
        })
        .catch((err: unknown) => {
          console.error("[TTS] Fetch error:", err);
          return null;
        });

      queueRef.current.push(bufferPromise);

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

    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // already stopped
      }
      try {
        currentSourceRef.current.disconnect();
      } catch {
        // already disconnected
      }
      currentSourceRef.current = null;
    }
    if (currentDoneRef.current) {
      currentDoneRef.current();
    }

    setStatus("idle");
  }, []);

  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const resumePromise =
      ctx.state === "suspended" ? ctx.resume() : Promise.resolve();

    resumePromise
      .then(() => {
        // Play a 1-sample silent buffer to fully unlock Web Audio on iOS.
        try {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
          unlockedRef.current = true;
        } catch (err) {
          console.warn("[TTS] Unlock silent-buffer failed:", err);
        }
      })
      .catch((err) => {
        console.warn("[TTS] Unlock resume rejected:", err);
      });
  }, [getAudioCtx]);

  return { status, enqueue, stop, unlock };
}
