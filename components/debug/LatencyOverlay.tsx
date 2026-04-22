"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  telemetry,
  isDebugEnabled,
  perceivedLatency,
  type Turn,
} from "@/lib/telemetry";

const EMPTY_SUBSCRIBE = () => () => {};
const getDebugClient = () => isDebugEnabled();
const getDebugServer = () => false;

function ms(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v)}ms`;
}

function dt(turn: Turn, k: Turn["marks"] extends infer T ? keyof T : never) {
  const base = turn.marks.speechEnd ?? turn.startedAt;
  const v = turn.marks[k as keyof typeof turn.marks];
  if (v === undefined) return null;
  return v - base;
}

export function LatencyOverlay() {
  const [turns, setTurns] = useState<Turn[]>([]);
  // useSyncExternalStore cleanly handles the SSR→client boundary without
  // tripping react-hooks/set-state-in-effect.
  const enabled = useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    getDebugClient,
    getDebugServer
  );

  useEffect(() => {
    if (!enabled) return;
    setTurns(telemetry.snapshot());
    return telemetry.subscribe(() => setTurns(telemetry.snapshot()));
  }, [enabled]);

  if (!enabled) return null;
  const last = turns[turns.length - 1];
  const p50 = percentile(turns.map((t) => perceivedLatency(t)), 50);
  const p95 = percentile(turns.map((t) => perceivedLatency(t)), 95);

  return (
    <div className="fixed top-2 right-2 z-50 max-w-xs rounded-lg bg-black/80 border border-white/20 px-3 py-2 font-mono text-[10px] text-white/80 leading-tight pointer-events-none">
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-emerald-300">latency</span>
        <span>
          p50 {ms(p50)} · p95 {ms(p95)} · n={turns.length}
        </span>
      </div>
      {last && (
        <div className="space-y-0.5">
          <div>
            turn #{last.id} · {last.mode}
            {last.language ? ` · ${last.language}` : ""}
          </div>
          <div>stt final: {ms(dt(last, "sttFinal"))}</div>
          <div>llm first: {ms(dt(last, "llmFirstToken"))}</div>
          <div>tts first: {ms(dt(last, "ttsFirstByte"))}</div>
          <div>filler play: {ms(dt(last, "fillerFirstPlay"))}</div>
          <div>audio play: {ms(dt(last, "audioFirstPlay"))}</div>
          <div className="text-emerald-300">
            perceived: {ms(perceivedLatency(last))}
          </div>
        </div>
      )}
    </div>
  );
}

function percentile(values: (number | null)[], p: number): number | null {
  const clean = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const idx = Math.min(
    clean.length - 1,
    Math.max(0, Math.ceil((p / 100) * clean.length) - 1)
  );
  return clean[idx];
}
