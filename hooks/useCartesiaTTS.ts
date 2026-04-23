"use client";

import { useCallback, useRef, useState } from "react";
import {
  getSharedAudioContext,
  resumeSharedAudioContext,
} from "@/lib/audio";
import { telemetry } from "@/lib/telemetry";

type TTSStatus = "idle" | "loading" | "speaking";

interface UseCartesiaTTSReturn {
  status: TTSStatus;
  enqueue: (text: string, language?: string) => void;
  // Streaming variant of enqueue: uses /api/tts/stream which proxies
  // Cartesia's WebSocket TTS and pipes raw PCM chunks as they arrive.
  // First audio plays ~150ms after speech-end instead of waiting for
  // the full WAV (~400-800ms). Per-chunk scheduling keeps playback
  // gap-free. Falls back to the batch enqueue() on stream errors.
  streamEnqueue: (text: string, language?: string) => void;
  // Push an already-synthesized WAV buffer (e.g. a pre-cached filler)
  // straight onto the playback queue, skipping the /api/tts fetch.
  // Used for sub-400ms-perceived acknowledgment playback at speech-end.
  enqueueBuffer: (buffer: ArrayBuffer) => void;
  // Synthesize once and return the raw ArrayBuffer so the caller can
  // cache it and later hand it back via enqueueBuffer. No queueing
  // happens here — pure fetch.
  preloadBuffer: (text: string, language?: string) => Promise<ArrayBuffer | null>;
  stop: () => void;
  unlock: () => void;
}

interface QueueEntry {
  buffer: Promise<ArrayBuffer | null>;
  // Filler entries emit telemetry as `fillerFirstPlay` rather than
  // `audioFirstPlay` so we can see both the perceived-response time
  // (filler starts) and the actual-LLM time (first real clause starts).
  isFiller: boolean;
}

export function useCartesiaTTS(): UseCartesiaTTSReturn {
  const [status, setStatus] = useState<TTSStatus>("idle");
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<QueueEntry[]>([]);
  const processingRef = useRef(false);
  const genRef = useRef(0);
  // Tracks when the tail of the most-recent-scheduled audio ends (in
  // AudioContext.currentTime units). Used by streamEnqueue to schedule
  // PCM chunks AFTER any filler still playing in the main queue, so
  // the streamed real-response audio doesn't overlap the filler.
  const tailTimeRef = useRef(0);
  const streamSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
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
        const entry = queueRef.current.shift()!;
        const arrayBuffer = await entry.buffer;

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
            // Keep tailTimeRef current so any streamEnqueue() that
            // arrives while this buffer is playing schedules its first
            // PCM chunk AFTER the tail — avoids filler+stream overlap.
            tailTimeRef.current = Math.max(
              tailTimeRef.current,
              ctx.currentTime + audioBuffer.duration
            );
            telemetry.mark(
              entry.isFiller ? "fillerFirstPlay" : "audioFirstPlay"
            );
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
    (text: string, language?: string) => {
      if (!text.trim()) return;

      const gen = genRef.current;
      setStatus((prev) => (prev === "idle" ? "loading" : prev));

      const bufferPromise = fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`TTS ${res.status}`);
          telemetry.mark("ttsFirstByte");
          return res.arrayBuffer();
        })
        .catch((err: unknown) => {
          console.error("[TTS] Fetch error:", err);
          return null;
        });

      queueRef.current.push({ buffer: bufferPromise, isFiller: false });

      if (!processingRef.current) {
        void processQueue(gen);
      }
    },
    [processQueue]
  );

  // Streaming variant: reads raw PCM chunks from /api/tts/stream as
  // they arrive from Cartesia's WebSocket and schedules each chunk
  // with precise playhead timing. First audio plays ~150ms after the
  // request instead of waiting for the full WAV from /api/tts. Plays
  // AFTER whatever is currently playing in the main queue (filler)
  // via tailTimeRef bookkeeping. Falls back to batch enqueue() on
  // any error so the customer always hears a response.
  const streamEnqueue = useCallback(
    (text: string, language?: string) => {
      if (!text.trim()) return;
      const gen = genRef.current;
      const ctx = getSharedAudioContext();
      if (!ctx) return;
      setStatus((prev) => (prev === "idle" ? "loading" : prev));

      const SAMPLE_RATE = 24000;
      // Flush accumulated bytes into an AudioBuffer every ~120 ms of
      // audio — small enough to start the first playback fast, big
      // enough that setInterval jitter doesn't create audible gaps.
      const MIN_CHUNK_BYTES = SAMPLE_RATE * 0.12 * 2; // ≈ 5,760 bytes
      const pending: Uint8Array[] = [];
      let pendingLen = 0;
      let firstPlayMarked = false;
      // Carry any trailing odd byte across flushes. Cartesia streams
      // pcm_s16le (two bytes per sample) but HTTP reads can split a
      // sample across two chunks. Truncating the orphan byte at flush
      // time (the old Math.floor byteLength/2 behaviour) caused a DC
      // step at every boundary and audible clicks on iOS Safari.
      let carry: Uint8Array | null = null;

      const schedule = (merged: Uint8Array) => {
        if (genRef.current !== gen) return;
        // Copy into a fresh, 2-byte-aligned backing store. Uint8Arrays
        // from a ReadableStream are not guaranteed to start on an even
        // byteOffset, and `new Int16Array(buf, offset, length)` throws
        // `RangeError` on unaligned offsets (WebKit) or silently reads
        // misaligned bytes as garbled samples (some engines). The
        // copy also guarantees an even byteLength so the view covers
        // exactly `merged.byteLength / 2` samples with no truncation.
        const evenLen = merged.byteLength & ~1; // clear the low bit
        if (evenLen === 0) return;
        const aligned = new Uint8Array(evenLen);
        aligned.set(merged.subarray(0, evenLen));
        const int16 = new Int16Array(aligned.buffer);
        if (int16.length === 0) return;
        const buf = ctx.createBuffer(1, int16.length, SAMPLE_RATE);
        const f32 = buf.getChannelData(0);
        for (let i = 0; i < int16.length; i++) {
          f32[i] = int16[i] / 32768;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        streamSourcesRef.current.add(src);
        src.onended = () => {
          streamSourcesRef.current.delete(src);
          if (streamSourcesRef.current.size === 0 && !processingRef.current) {
            setStatus("idle");
          }
          try {
            src.disconnect();
          } catch {
            /* already disconnected */
          }
        };
        const startAt = Math.max(ctx.currentTime, tailTimeRef.current);
        try {
          src.start(startAt);
        } catch (err) {
          console.warn("[TTS stream] source.start failed:", err);
          return;
        }
        tailTimeRef.current = startAt + buf.duration;
        if (!firstPlayMarked) {
          firstPlayMarked = true;
          telemetry.mark("audioFirstPlay");
        }
        setStatus("speaking");
      };

      const run = async () => {
        try {
          const response = await fetch("/api/tts/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language }),
          });
          if (!response.ok || !response.body) {
            throw new Error(`stream ${response.status}`);
          }
          telemetry.mark("ttsFirstByte");
          const reader = response.body.getReader();
          await resumeSharedAudioContext();
          while (true) {
            const { done, value } = await reader.read();
            if (done || genRef.current !== gen) break;
            if (!value || value.byteLength === 0) continue;
            pending.push(value);
            pendingLen += value.byteLength;
            if (pendingLen >= MIN_CHUNK_BYTES) {
              // If the carry from the previous flush exists, prepend
              // it so its byte lands as the low byte of the next
              // sample rather than getting orphaned.
              const totalLen = pendingLen + (carry?.byteLength ?? 0);
              const merged = new Uint8Array(totalLen);
              let offset = 0;
              if (carry) {
                merged.set(carry, offset);
                offset += carry.byteLength;
                carry = null;
              }
              for (const p of pending) {
                merged.set(p, offset);
                offset += p.byteLength;
              }
              pending.length = 0;
              pendingLen = 0;
              // Carry the trailing odd byte forward if any so schedule()
              // only ever sees an even-length buffer.
              if ((merged.byteLength & 1) === 1) {
                carry = merged.slice(merged.byteLength - 1);
                schedule(merged.subarray(0, merged.byteLength - 1));
              } else {
                schedule(merged);
              }
            }
          }
          // Flush trailing <120ms remainder (plus any carry).
          const tailLen = pendingLen + (carry?.byteLength ?? 0);
          if (tailLen > 0 && genRef.current === gen) {
            const merged = new Uint8Array(tailLen);
            let offset = 0;
            if (carry) {
              merged.set(carry, offset);
              offset += carry.byteLength;
              carry = null;
            }
            for (const p of pending) {
              merged.set(p, offset);
              offset += p.byteLength;
            }
            schedule(merged);
          }
        } catch (err) {
          console.warn(
            "[TTS stream] failed, falling back to batch enqueue:",
            err
          );
          // Fallback: hit the old batch route so the customer still
          // hears a response even if the stream proxy hiccups.
          if (genRef.current !== gen) return;
          const bufferPromise = fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language }),
          })
            .then((res) => (res.ok ? res.arrayBuffer() : null))
            .catch(() => null);
          queueRef.current.push({
            buffer: bufferPromise,
            isFiller: false,
          });
          if (!processingRef.current) {
            void processQueue(gen);
          }
        }
      };

      void run();
    },
    [processQueue]
  );

  const enqueueBuffer = useCallback(
    (buffer: ArrayBuffer) => {
      const gen = genRef.current;
      setStatus((prev) => (prev === "idle" ? "loading" : prev));
      queueRef.current.push({
        buffer: Promise.resolve(buffer),
        isFiller: true,
      });
      if (!processingRef.current) {
        void processQueue(gen);
      }
    },
    [processQueue]
  );

  const preloadBuffer = useCallback(
    async (text: string, language?: string): Promise<ArrayBuffer | null> => {
      if (!text.trim()) return null;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language }),
        });
        if (!res.ok) return null;
        return await res.arrayBuffer();
      } catch {
        return null;
      }
    },
    []
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

    // Cancel any streaming PCM chunks mid-playback (barge-in during a
    // streamed response). The in-flight fetch reader sees genRef change
    // and exits its loop.
    for (const src of streamSourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    streamSourcesRef.current.clear();
    tailTimeRef.current = 0;

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

  return {
    status,
    enqueue,
    streamEnqueue,
    enqueueBuffer,
    preloadBuffer,
    stop,
    unlock,
  };
}
