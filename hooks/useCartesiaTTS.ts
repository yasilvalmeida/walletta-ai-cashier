"use client";

import { useCallback, useRef, useState } from "react";
import {
  getSharedAudioContext,
  resumeSharedAudioContext,
} from "@/lib/audio";

type TTSStatus = "idle" | "loading" | "speaking";

interface UseCartesiaTTSReturn {
  status: TTSStatus;
  enqueue: (text: string) => void;
  stop: () => void;
  unlock: () => void;
}

export function useCartesiaTTS(): UseCartesiaTTSReturn {
  const [status, setStatus] = useState<TTSStatus>("idle");
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<Array<Promise<ArrayBuffer | null>>>([]);
  const processingRef = useRef(false);
  const genRef = useRef(0);
  const unlockedRef = useRef(false);
  const currentDoneRef = useRef<(() => void) | null>(null);

  const decodeBuffer = useCallback(
    (ctx: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> =>
      new Promise((resolve) => {
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

      const ctx = getSharedAudioContext();
      if (!ctx) {
        processingRef.current = false;
        return;
      }

      while (queueRef.current.length > 0 && genRef.current === gen) {
        const bufferPromise = queueRef.current.shift()!;
        const arrayBuffer = await bufferPromise;

        if (genRef.current !== gen || !arrayBuffer) continue;

        // Force-resume every cycle — iOS can silently re-suspend the
        // context after session changes (e.g. getUserMedia promoting to
        // playAndRecord). Without this, source.start() plays into the
        // void and onended never fires.
        const postState = await resumeSharedAudioContext();
        if (postState !== "running") {
          console.warn("[TTS] ctx not running after resume:", postState);
        }

        const audioBuffer = await decodeBuffer(ctx, arrayBuffer);
        if (!audioBuffer || genRef.current !== gen) continue;

        setStatus("speaking");
        console.log(
          "[TTS] Playing",
          audioBuffer.duration.toFixed(2),
          "s, ctx:",
          ctx.state
        );

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

          // Safety: if onended never fires (ctx stalled, buffer played
          // into a suspended destination, etc.) the queue would hang
          // forever. Fall through after buffer duration + 1.5 s.
          const safetyMs = Math.ceil(audioBuffer.duration * 1000) + 1500;
          setTimeout(() => {
            if (!settled) {
              console.warn("[TTS] Playback timeout — forcing next");
              done();
            }
          }, safetyMs);
        });
      }

      if (genRef.current === gen) {
        processingRef.current = false;
        setStatus("idle");
      }
    },
    [decodeBuffer]
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
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const resumePromise =
      ctx.state === "suspended" ? ctx.resume() : Promise.resolve();

    resumePromise
      .then(() => {
        try {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
          unlockedRef.current = true;
          console.log("[TTS] Unlocked, ctx:", ctx.state);
        } catch (err) {
          console.warn("[TTS] Unlock silent-buffer failed:", err);
        }
      })
      .catch((err) => {
        console.warn("[TTS] Unlock resume rejected:", err);
      });
  }, []);

  return { status, enqueue, stop, unlock };
}
