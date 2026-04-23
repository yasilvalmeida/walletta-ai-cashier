"use client";

import { useCallback, useEffect, useState } from "react";

interface BenchProviderResult {
  provider: "openai" | "groq";
  model: string;
  ok: boolean;
  error?: string;
  ttftMs?: number;
  totalMs?: number;
  outputTokens?: number;
  tokensPerSec?: number;
  responseText?: string;
  toolCalls?: Array<{ name: string; args: string }>;
}

interface BenchRun {
  id: number;
  timestamp: number;
  prompt: string;
  providers: BenchProviderResult[];
}

const PRESET_PROMPTS = [
  "I'll take a matcha latte, please.",
  "Can I get a large oat milk americano and a butter croissant?",
  "What do you recommend for a cold afternoon drink?",
  "Actually, remove the croissant and add two cappuccinos.",
  "That's all, thanks.",
];

export default function BenchPage() {
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0]);
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/bench/llm");
      const data = (await res.json()) as { runs: BenchRun[] };
      setRuns(data.runs);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const runBench = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bench/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          providers: ["openai", "groq"],
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(
          typeof body.error === "string" ? body.error : `HTTP ${res.status}`
        );
      }
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bench failed");
    } finally {
      setLoading(false);
    }
  }, [prompt, loadHistory]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-mono text-sm">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-sans font-semibold">LLM benchmark</h1>
          <p className="text-white/60 font-sans text-xs">
            Runs the prompt against OpenAI gpt-4o and Groq llama-3.3-70b-versatile
            in parallel with our add_to_cart tool schema. Measures time-to-first-
            token, total stream duration, tokens/sec. In-memory ring buffer of
            the last 100 runs (resets on Vercel redeploy).
          </p>
        </header>

        <section className="space-y-3 bg-zinc-900 rounded-xl p-4 border border-white/10">
          <label className="block text-xs text-white/50 uppercase tracking-wider">
            Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full bg-zinc-950 border border-white/15 rounded-lg p-3 text-sm font-mono text-white placeholder-white/30 focus:outline-none focus:border-white/40"
            placeholder="What would you like to order?"
          />
          <div className="flex flex-wrap gap-2">
            {PRESET_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="text-xs px-2 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-white/70"
              >
                {p.length > 40 ? p.slice(0, 38) + "…" : p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={runBench}
              disabled={loading || !prompt.trim()}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-white/40 text-black font-sans font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? "Running…" : "Run benchmark"}
            </button>
            {error && <span className="text-red-400 text-xs">{error}</span>}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-white/50">
            History ({runs.length})
          </h2>
          {runs.length === 0 && (
            <p className="text-white/40 text-xs">No runs yet.</p>
          )}
          {runs.map((run) => {
            const openai = run.providers.find((p) => p.provider === "openai");
            const groq = run.providers.find((p) => p.provider === "groq");
            const winner =
              openai?.ok && groq?.ok && openai.ttftMs && groq.ttftMs
                ? openai.ttftMs < groq.ttftMs
                  ? "openai"
                  : "groq"
                : null;
            return (
              <div
                key={run.id}
                className="bg-zinc-900 rounded-xl p-4 border border-white/10 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white/40">
                      #{run.id} · {new Date(run.timestamp).toLocaleTimeString()}
                    </div>
                    <p className="text-sm text-white/80 mt-1 break-words">
                      "{run.prompt}"
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ProviderCard result={openai} winner={winner === "openai"} />
                  <ProviderCard result={groq} winner={winner === "groq"} />
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

function ProviderCard({
  result,
  winner,
}: {
  result?: BenchProviderResult;
  winner?: boolean;
}) {
  if (!result) return null;
  const badge = result.provider === "openai" ? "OpenAI" : "Groq";
  return (
    <div
      className={`rounded-lg p-3 border text-xs space-y-1.5 ${
        winner
          ? "border-emerald-400/50 bg-emerald-500/5"
          : "border-white/10 bg-zinc-950"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-sans font-semibold text-white/90">
          {badge} {winner && "🏆"}
        </span>
        <span className="text-white/40 text-[10px]">{result.model}</span>
      </div>
      {!result.ok && (
        <p className="text-red-400 text-[11px]">{result.error}</p>
      )}
      {result.ok && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="TTFT" value={fmtMs(result.ttftMs)} />
            <Metric label="Total" value={fmtMs(result.totalMs)} />
            <Metric label="Tok/s" value={result.tokensPerSec?.toString() ?? "—"} />
          </div>
          {result.toolCalls && result.toolCalls.length > 0 && (
            <div className="text-[11px] text-emerald-300/80">
              → {result.toolCalls.map((tc) => tc.name).join(", ")}
            </div>
          )}
          {result.responseText && (
            <p className="text-white/60 text-[11px] break-words border-t border-white/5 pt-1.5 mt-1.5">
              {result.responseText.slice(0, 180)}
              {result.responseText.length > 180 && "…"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-white/40 text-[10px] uppercase tracking-wider">
        {label}
      </div>
      <div className="text-white/90 text-sm tabular-nums font-semibold">
        {value}
      </div>
    </div>
  );
}

function fmtMs(ms?: number): string {
  if (ms === undefined) return "—";
  return `${ms} ms`;
}
