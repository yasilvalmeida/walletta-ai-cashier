// In-memory ring buffer for /api/bench/llm results. Survives only
// until the Vercel serverless function instance recycles — fine for
// a quick-comparison tool; if we want durable logs we'd swap this
// for Vercel KV or a file. Bounded to keep memory flat.

export interface BenchRun {
  id: number;
  timestamp: number;
  prompt: string;
  providers: BenchProviderResult[];
}

export interface BenchProviderResult {
  provider: "openai" | "groq";
  model: string;
  ok: boolean;
  error?: string;
  // All latencies in milliseconds.
  ttftMs?: number;
  totalMs?: number;
  // Token counts (approx — measured from streamed chunks).
  outputTokens?: number;
  tokensPerSec?: number;
  responseText?: string;
  toolCalls?: Array<{ name: string; args: string }>;
}

const MAX = 100;
let seq = 0;
const runs: BenchRun[] = [];

export function pushRun(run: Omit<BenchRun, "id">): BenchRun {
  seq += 1;
  const full: BenchRun = { ...run, id: seq };
  runs.push(full);
  while (runs.length > MAX) runs.shift();
  return full;
}

export function listRuns(): BenchRun[] {
  // Most recent first.
  return [...runs].reverse();
}

export function clearRuns(): void {
  runs.length = 0;
  seq = 0;
}
