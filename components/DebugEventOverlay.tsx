"use client";

import { useEffect, useState } from "react";

interface DebugEvent {
  t: number;
  kind: string;
  summary: string;
}

interface DebugEventOverlayProps {
  conversationId: string | null;
  enabled: boolean;
}

// Small fixed overlay that visualises the SSE channel so we can see
// live on the iPad whether Tavus tool-calls are reaching the client.
// Enabled with ?debug=events in the URL.
export function DebugEventOverlay({
  conversationId,
  enabled,
}: DebugEventOverlayProps) {
  const [sseState, setSseState] = useState<
    "idle" | "connecting" | "open" | "error" | "closed"
  >("idle");
  const [eventCount, setEventCount] = useState(0);
  const [events, setEvents] = useState<DebugEvent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    if (!conversationId) {
      setSseState("idle");
      return;
    }
    if (typeof window === "undefined") return;

    setSseState("connecting");
    const source = new EventSource(
      `/api/tavus/events?conversationId=${encodeURIComponent(conversationId)}`
    );
    source.onopen = () => setSseState("open");
    source.onerror = () => setSseState("error");
    source.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as {
          kind?: string;
          role?: string;
          action?: string;
          speech?: string;
          payload?: { product_name?: string };
        };
        const kind = data.kind ?? "?";
        let summary = "";
        if (kind === "transcript") {
          summary = `${data.role ?? ""}: ${(data.speech ?? "").slice(0, 40)}`;
        } else if (kind === "cart_action") {
          summary = `${data.action ?? ""} ${data.payload?.product_name ?? ""}`;
        } else if (kind === "finalize") {
          summary = "(modal)";
        }
        setEventCount((n) => n + 1);
        setEvents((arr) =>
          [{ t: Date.now(), kind, summary }, ...arr].slice(0, 6)
        );
      } catch {
        // ignore parse errors
      }
    };
    return () => {
      source.close();
      setSseState("closed");
    };
  }, [conversationId, enabled]);

  if (!enabled) return null;

  const color =
    sseState === "open"
      ? "bg-emerald-400"
      : sseState === "connecting"
        ? "bg-amber-400 animate-pulse"
        : sseState === "error"
          ? "bg-red-500"
          : "bg-white/30";

  return (
    <div className="fixed top-2 right-2 z-50 max-w-[280px] rounded-lg bg-black/80 backdrop-blur-sm text-white text-[10px] font-mono p-2 border border-white/20 pointer-events-none">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
        <span>
          sse:{sseState} {eventCount} evt
        </span>
      </div>
      {conversationId && (
        <div className="text-white/50 truncate mb-1">
          {conversationId.slice(0, 12)}…
        </div>
      )}
      {events.length === 0 ? (
        <div className="text-white/40 italic">no events yet</div>
      ) : (
        <ul className="space-y-0.5">
          {events.map((e, i) => (
            <li key={i} className="truncate">
              <span className="text-white/50">{e.kind}</span> {e.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
