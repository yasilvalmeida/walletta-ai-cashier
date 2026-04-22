"use client";

// Turn-scoped latency telemetry for the voice pipeline. Each user
// utterance creates a `Turn` that collects performance.now() marks at
// well-known pipeline points. Consumers can subscribe to completed
// turns to render a live debug overlay or capture a JSON dump.

export type TurnMark =
  | "speechStart"
  | "speechEnd"
  | "sttFirstPartial"
  | "sttFinal"
  | "chatRequestSent"
  | "llmFirstToken"
  | "llmDone"
  | "ttsFirstByte"
  | "audioFirstPlay"
  | "fillerFirstPlay"
  | "audioDone";

export interface Turn {
  id: number;
  startedAt: number;
  marks: Partial<Record<TurnMark, number>>;
  mode: "cartesia" | "tavus";
  language?: string;
}

type Listener = (turn: Turn) => void;

class TelemetryBus {
  private seq = 0;
  private current: Turn | null = null;
  private listeners: Set<Listener> = new Set();
  private history: Turn[] = [];

  // Start a new turn if none is active. Mode is optional — callers
  // deeper in the pipeline (e.g. sendToChat) set it once they know
  // whether Cartesia or Tavus will speak this turn.
  ensureTurn(): Turn {
    if (this.current) return this.current;
    this.seq += 1;
    const now = performance.now();
    const turn: Turn = {
      id: this.seq,
      startedAt: now,
      marks: { speechStart: now },
      mode: "cartesia",
    };
    this.current = turn;
    return turn;
  }

  setMode(mode: "cartesia" | "tavus"): void {
    const turn = this.current;
    if (!turn) return;
    turn.mode = mode;
  }

  mark(name: TurnMark, extra?: { language?: string }): void {
    const turn = this.ensureTurn();
    if (turn.marks[name] !== undefined) return;
    turn.marks[name] = performance.now();
    if (extra?.language) turn.language = extra.language;
  }

  endTurn(): void {
    const turn = this.current;
    if (!turn) return;
    this.current = null;
    this.history.push(turn);
    if (this.history.length > 50) this.history.shift();
    for (const l of this.listeners) l(turn);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot(): Turn[] {
    return [...this.history];
  }

  currentTurn(): Turn | null {
    return this.current;
  }

  // Test-only helper — drop all in-memory state so tests don't see
  // residue from prior tests. Not exported for production callers.
  reset(): void {
    this.current = null;
    this.history = [];
    this.seq = 0;
    this.listeners.clear();
  }
}

// Single module-level instance shared by all hooks. No React context
// needed — telemetry is observational and does not drive renders.
export const telemetry = new TelemetryBus();

export function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const v = params.get("debug");
  return v === "1" || v === "true" || v === "latency";
}

export function formatDelta(
  turn: Turn,
  from: TurnMark,
  to: TurnMark
): number | null {
  const a = turn.marks[from];
  const b = turn.marks[to];
  if (a === undefined || b === undefined) return null;
  return Math.max(0, b - a);
}

// Perceived latency = speech-end → first audible feedback. The filler
// acknowledgment plays within ~50ms of speech-end in Cartesia mode,
// so that's our sub-400ms perceived-latency signal. Falls back to
// audioFirstPlay (real LLM response) then llmFirstToken (Tavus mode
// where the avatar owns the voice).
export function perceivedLatency(turn: Turn): number | null {
  const speechEnd = turn.marks.speechEnd;
  if (speechEnd === undefined) return null;
  const end =
    turn.marks.fillerFirstPlay ??
    turn.marks.audioFirstPlay ??
    turn.marks.llmFirstToken;
  if (end === undefined) return null;
  return Math.max(0, end - speechEnd);
}
